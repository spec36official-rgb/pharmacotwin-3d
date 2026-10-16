"""
FastAPI Backend Server for PharmacoTwin 3D
Serves:
- /api/drugs: Preset drug database + Phase 2 AlphaFold 3 novel drug templates + Toxicology curriculum
- /api/simulate: Phase 1 + Phase 3 Multi-Scale 2-Compartment PK/PD + Thermodynamic + 8-Organ Toxicity + Argon Reasoning + Verification Loop
- /api/af3-approximate: Phase 2 AlphaFold 3 Structure-to-PK/PD Approximator + Full Simulation
- /api/upload-photo: Dynamic user photo upload -> auto-orientation -> 3D UV face texture generation
- /api/verify-protocol: Human-in-the-Loop Clinical/Research Safety Gate sign-off
- /healthz: Cloud Run health check
- / : Static 3D WebGL Digital Twin UI
"""

import io
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from pydantic import BaseModel, Field

from backend.argon_agent import (
    DRUG_KO_TRANSLATIONS,
    LECTURE_NOVEL_TEMPLATES,
    PGX_GENOTYPE_LIBRARY,
    TOXICOLOGY_CURRICULUM_CONTEXT,
    TOXICOLOGY_CURRICULUM_CONTEXT_KO,
    analyze_simulation_with_argon,
    approximate_novel_drug_af3,
)
from backend.drug_db import (
    DRUG_DATABASE,
    get_all_drugs_summary,
)
from backend.pkpd_engine import (
    DosingRegimen,
    PatientProfile,
    simulate_pkpd_and_organs,
)

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
ASSETS_DIR = STATIC_DIR / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="PharmacoTwin 3D API",
    description=(
        "Multi-Scale 3D Pharmacokinetic/Pharmacodynamic (PK/PD) & Structural Toxicity "
        "Simulator powered by Gemini 4 Argon & AlphaFold 3"
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulationRequest(BaseModel):
    drug_id: str = Field(default="acetaminophen")
    route: str = Field(default="oral")  # oral, iv_bolus, iv_infusion
    dose_mg: Optional[float] = Field(default=None, gt=0.1, le=50000.0)
    infusion_duration_h: float = Field(default=0.5, ge=0.0, le=24.0)
    interval_h: float = Field(default=8.0, gt=0.5, le=72.0)
    num_doses: int = Field(default=1, ge=1, le=14)
    duration_h: float = Field(default=24.0, ge=4.0, le=120.0)
    thinking_level: str = Field(default="medium")
    patient: PatientProfile = Field(default_factory=PatientProfile)


class AF3ApproximationRequest(BaseModel):
    molecule_name: str = Field(default="Cisplatin")
    smiles: str = Field(default="N.N.Cl[Pt]Cl")
    route: str = Field(default="iv_bolus")
    dose_mg: float = Field(default=100.0, gt=0.1, le=50000.0)
    infusion_duration_h: float = Field(default=1.0, ge=0.0, le=24.0)
    interval_h: float = Field(default=12.0, gt=0.5, le=72.0)
    num_doses: int = Field(default=1, ge=1, le=14)
    duration_h: float = Field(default=24.0, ge=4.0, le=120.0)
    patient: PatientProfile = Field(default_factory=PatientProfile)


PROTOCOL_DECISIONS = {"approved", "approved_with_monitoring", "needs_revision", "rejected"}
APPROVING_DECISIONS = {"approved", "approved_with_monitoring"}


class ProtocolApprovalRequest(BaseModel):
    simulation_id: str = Field(default="sim-default")
    reviewer_name: str = Field(default="")
    reviewer_role: str = Field(default="PharmD / Toxicology Researcher")
    decision: Optional[str] = Field(default=None)
    approved: Optional[bool] = Field(default=None)
    clinical_notes: str = Field(default="")
    selected_antidote: Optional[str] = Field(default=None)


PROTOCOL_AUDIT_LOG: list[Dict[str, Any]] = []


@app.get("/healthz")
def healthz():
    return {
        "status": "ok",
        "service": "pharmacotwin-3d",
        "argon_model": os.environ.get("ARGON_MODEL_ID", "gemini-4-argon"),
        "timestamp": time.time(),
    }


@app.get("/api/drugs")
def list_drugs():
    """Return all 6 preset drugs, Phase 2 AlphaFold 3 novel drug templates, PGx genotypes, and lecture curriculum."""
    novel_samples = [
        {
            "id": k,
            "name": v["name"],
            "korean_name": v["korean_name"],
            "smiles": v["smiles"],
            "mw_g_mol": v["mw_g_mol"],
            "logp": v["logp"],
            "target_protein": v["target_protein"],
            "uniprot_id": v.get("uniprot_id", "P05181"),
            "primary_organ": v["primary_organ"],
            "mechanism": v["mechanism"],
            "mechanism_ko": v.get("mechanism_ko", v["mechanism"]),
        }
        for k, v in LECTURE_NOVEL_TEMPLATES.items()
    ]
    return {
        "preset_drugs": get_all_drugs_summary(),
        "novel_drug_samples": novel_samples,
        "curriculum_context": TOXICOLOGY_CURRICULUM_CONTEXT,
        "curriculum_context_ko": TOXICOLOGY_CURRICULUM_CONTEXT_KO,
        "pgx_genotype_library": PGX_GENOTYPE_LIBRARY,
        "drug_ko_translations": DRUG_KO_TRANSLATIONS,
    }


@app.get("/api/drugs/{drug_id}")
def get_drug_detail(drug_id: str):
    drug = DRUG_DATABASE.get(drug_id.lower())
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drug_id}' not found")
    return drug


@app.post("/api/simulate")
def run_simulation(req: SimulationRequest):
    """
    Execute Phase 1 + Phase 3 Multi-Scale PK/PD + Thermodynamic + 8-Organ Toxicity simulation,
    followed by Gemini 4 Argon reasoning and the 6-check Pass/Fail Verification Loop.
    """
    drug = DRUG_DATABASE.get(req.drug_id.lower())
    if not drug:
        raise HTTPException(status_code=404, detail=f"Unknown drug_id '{req.drug_id}'")

    dose_mg = req.dose_mg if req.dose_mg is not None else float(drug["recommended_dose_mg"])
    regimen = DosingRegimen(
        drug_id=drug["id"],
        route=req.route,
        dose_mg=dose_mg,
        infusion_duration_h=req.infusion_duration_h,
        interval_h=req.interval_h,
        num_doses=req.num_doses,
        duration_h=req.duration_h,
    )

    sim_result = simulate_pkpd_and_organs(drug=drug, patient=req.patient, regimen=regimen)
    argon_analysis = analyze_simulation_with_argon(
        sim_result=sim_result,
        patient=req.patient,
        regimen=regimen,
        thinking_level=req.thinking_level,
    )
    ko_bundle = DRUG_KO_TRANSLATIONS.get(drug["id"], {})

    return {
        "simulation_id": f"sim-{uuid.uuid4().hex[:8]}",
        "drug_detail": {
            "id": drug["id"],
            "name": drug["name"],
            "korean_name": drug["korean_name"],
            "drug_class": drug["drug_class"],
            "smiles": drug["smiles"],
            "mw_g_mol": drug["mw_g_mol"],
            "logp": drug["logp"],
            "recommended_dose_mg": drug["recommended_dose_mg"],
            "toxic_demo_dose_mg": drug["toxic_demo_dose_mg"],
            "clinical_pearls": drug["clinical_pearls"],
            "clinical_pearls_ko": ko_bundle.get("clinical_pearls_ko", drug["clinical_pearls"]),
            "antidote": drug["antidote"],
            "antidote_ko": ko_bundle.get("antidote_ko", ""),
            "organs_ko": ko_bundle.get("organs_ko", {}),
        },
        "simulation": sim_result,
        "argon_analysis": argon_analysis,
        "verification_loop": argon_analysis["verification_loop"],
        # Every simulation needs human sign-off via /api/verify-protocol, regardless of predicted risk.
        "requires_human_approval": True,
    }


@app.post("/api/af3-approximate")
def run_af3_approximation(req: AF3ApproximationRequest):
    """
    Phase 2: Predict AlphaFold 3 co-folded receptor-ligand binding pocket, inter-atomic contacts,
    and ADMET/PK/PD parameters from SMILES, then immediately run the full 3D body simulation.
    """
    regimen = DosingRegimen(
        drug_id="novel_af3",
        route=req.route,
        dose_mg=req.dose_mg,
        infusion_duration_h=req.infusion_duration_h,
        interval_h=req.interval_h,
        num_doses=req.num_doses,
        duration_h=req.duration_h,
    )
    bundle = approximate_novel_drug_af3(
        molecule_name=req.molecule_name,
        smiles=req.smiles,
        patient=req.patient,
        regimen=regimen,
    )
    return {
        "simulation_id": f"af3-{uuid.uuid4().hex[:8]}",
        "af3_job_spec": bundle["af3_job_spec"],
        "af3_job_metadata": bundle["af3_job_metadata"],
        "af_ebi_live": bundle["af_ebi_live"],
        "approximated_drug_profile": bundle["approximated_drug_profile"],
        "simulation": bundle["simulation"],
        "argon_analysis": bundle["argon_analysis"],
        "verification_loop": bundle["argon_analysis"]["verification_loop"],
        "requires_human_approval": True,
    }


@app.post("/api/upload-photo")
async def upload_user_photo(file: UploadFile = File(...)):
    """
    Accept a user portrait photo, auto-correct sideways orientation, and generate:
    - user_avatar.jpg (512x512 portrait)
    - user_face_front.jpg (512x512 face crop)
    - user_face_uv.jpg (1024x512 spherical UV texture map for the 3D head mesh)
    """
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image file: {exc}")

    w, h = img.size
    if w > h * 1.15:
        img = img.rotate(270, expand=True)
        w, h = img.size

    side = min(w, h)
    left = (w - side) // 2
    top = int((h - side) * 0.25)
    avatar_square = img.crop((left, top, left + side, top + side)).resize(
        (512, 512), Image.Resampling.LANCZOS
    )
    avatar_square = ImageEnhance.Contrast(avatar_square).enhance(1.06)

    face_side = int(side * 0.68)
    f_left = (w - face_side) // 2
    f_top = int(h * 0.16)
    if f_top + face_side > h:
        f_top = max(0, h - face_side)
    face_crop = img.crop((f_left, f_top, f_left + face_side, f_top + face_side)).resize(
        (512, 512), Image.Resampling.LANCZOS
    )

    center_patch = face_crop.crop((180, 180, 330, 330)).resize((1, 1), Image.Resampling.BOX)
    skin_rgb = center_patch.getpixel((0, 0))
    skin_rgb = (
        min(255, int(skin_rgb[0] * 1.05)),
        min(255, int(skin_rgb[1] * 1.03)),
        min(255, int(skin_rgb[2] * 1.02)),
    )

    uv_w, uv_h = 1024, 512
    uv_canvas = Image.new("RGB", (uv_w, uv_h), skin_rgb)
    face_resized = face_crop.resize((380, 420), Image.Resampling.LANCZOS)

    mask = Image.new("L", (380, 420), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((20, 20, 360, 400), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=28))

    paste_x = (uv_w - 380) // 2
    paste_y = (uv_h - 420) // 2
    uv_canvas.paste(face_resized, (paste_x, paste_y), mask)

    ts = int(time.time())
    avatar_square.save(ASSETS_DIR / "user_avatar.jpg", quality=92)
    face_crop.save(ASSETS_DIR / "user_face_front.jpg", quality=92)
    uv_canvas.save(ASSETS_DIR / "user_face_uv.jpg", quality=92)

    return {
        "status": "ok",
        "avatar_url": f"/static/assets/user_avatar.jpg?v={ts}",
        "face_front_url": f"/static/assets/user_face_front.jpg?v={ts}",
        "face_uv_url": f"/static/assets/user_face_uv.jpg?v={ts}",
        "sampled_skin_rgb": skin_rgb,
    }


@app.post("/api/verify-protocol")
def approve_clinical_protocol(req: ProtocolApprovalRequest):
    """
    Human-in-the-Loop sign-off gate. Every simulation must be reviewed here before export.
    Requires a named reviewer and an explicit decision (and/or `approved` flag); every sign-off,
    including rejections, is appended to the audit log.
    """
    reviewer = req.reviewer_name.strip()
    if not reviewer:
        raise HTTPException(status_code=422, detail="reviewer_name is required for human sign-off")
    if not req.simulation_id.strip():
        raise HTTPException(status_code=422, detail="simulation_id is required")
    if req.decision is None and req.approved is None:
        raise HTTPException(status_code=422, detail="An explicit decision or approved flag is required")
    decision = req.decision or ("approved" if req.approved else "rejected")
    if decision not in PROTOCOL_DECISIONS:
        raise HTTPException(
            status_code=422,
            detail=f"decision must be one of {sorted(PROTOCOL_DECISIONS)}",
        )
    approved = decision in APPROVING_DECISIONS
    if req.approved is not None and req.approved != approved:
        raise HTTPException(status_code=422, detail=f"approved={req.approved} contradicts decision '{decision}'")

    record = {
        "approval_id": f"gate-{uuid.uuid4().hex[:8]}",
        "simulation_id": req.simulation_id,
        "reviewer_name": reviewer,
        "reviewer_role": req.reviewer_role,
        "decision": decision,
        "approved": approved,
        "clinical_notes": req.clinical_notes,
        "selected_antidote": req.selected_antidote,
        "timestamp_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    PROTOCOL_AUDIT_LOG.append(record)
    return {
        "status": "verified" if approved else "rejected",
        "approved": approved,
        "record": record,
        "total_approvals": sum(1 for r in PROTOCOL_AUDIT_LOG if r["approved"]),
        "total_reviews": len(PROTOCOL_AUDIT_LOG),
    }


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/architecture")
def serve_architecture():
    arch_file = STATIC_DIR / "architecture.html"
    if arch_file.exists():
        return FileResponse(str(arch_file))
    raise HTTPException(status_code=404, detail="architecture.html not found")


@app.get("/")
def serve_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse({"message": "PharmacoTwin 3D API is running. Static UI being built."})
