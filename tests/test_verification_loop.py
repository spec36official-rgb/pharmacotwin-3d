"""
Automated Pytest Verification Suite for PharmacoTwin 3D
Validates:
1. 2-Compartment PK/PD ODE solver & Cockcroft-Gault CrCl math
2. Lennard-Jones 12-6 + Coulomb thermodynamic binding affinity (Delta G -> Kd -> EC50)
3. All 6 preset drugs & 8-organ toxicity time-series
4. Phase 2 AlphaFold 3 Novel Drug Structure-to-PK/PD Approximator
5. Phase 3 Pharmacogenomics (PGx / AlphaGenome) sensitivity checks
6. Deterministic 5-point Pass/Fail Verification Loop & FastAPI endpoints
"""

from pathlib import Path
from fastapi.testclient import TestClient

from backend.drug_db import DRUG_DATABASE
from backend.main import app
from backend.pkpd_engine import (
    DosingRegimen,
    PatientProfile,
    compute_cockcroft_gault_crcl,
    compute_thermodynamic_affinity,
    simulate_pkpd_and_organs,
)

client = TestClient(app)


def test_cockcroft_gault_crcl():
    # Standard 24yo male, 68kg, SCr 0.95 mg/dL -> ((140-24)*68)/(72*0.95) = 115.32 mL/min
    p_normal = PatientProfile(age=24, sex="M", weight_kg=68.0, serum_creatinine_mg_dl=0.95)
    crcl_normal = compute_cockcroft_gault_crcl(p_normal)
    assert 112.0 <= crcl_normal <= 118.0

    # Elderly female with renal impairment: 75yo, 55kg, SCr 2.4 mg/dL
    p_renal = PatientProfile(age=75, sex="F", weight_kg=55.0, serum_creatinine_mg_dl=2.4)
    crcl_renal = compute_cockcroft_gault_crcl(p_renal)
    assert crcl_renal < 25.0


def test_thermodynamic_binding_all_preset_drugs():
    for drug_id, drug in DRUG_DATABASE.items():
        s3d = drug["structure_3d"]
        thermo = compute_thermodynamic_affinity(
            contacts=s3d["pocket_contacts"],
            buried_hydrophobic_area_a2=s3d["buried_area_a2"],
            hbond_count=s3d["hbond_count"],
            rotatable_bonds=s3d["rotatable_bonds"],
            mw_g_mol=drug["mw_g_mol"],
            fu_plasma=drug["pk"]["fu_plasma"],
        )
        assert -14.5 <= thermo["delta_g_kcal_mol"] <= -3.2, f"Out of range DeltaG for {drug_id}"
        assert thermo["kd_um"] > 0.0
        assert thermo["ec50_tox_mg_l"] > 0.0


def test_acetaminophen_overdose_and_cyp2e1_pgx():
    apap = DRUG_DATABASE["acetaminophen"]
    p_std = PatientProfile(cyp2e1_phenotype="normal")
    reg_std = DosingRegimen(drug_id="acetaminophen", route="oral", dose_mg=1000.0, interval_h=8.0, num_doses=3)
    sim_std = simulate_pkpd_and_organs(drug=apap, patient=p_std, regimen=reg_std)

    # Overdose + CYP2E1 induced (alcohol/isoniazid) + moderate hepatic impairment
    p_high_risk = PatientProfile(cyp2e1_phenotype="induced", hepatic_function="moderate_impairment")
    reg_tox = DosingRegimen(drug_id="acetaminophen", route="oral", dose_mg=4000.0, interval_h=6.0, num_doses=3)
    sim_tox = simulate_pkpd_and_organs(drug=apap, patient=p_high_risk, regimen=reg_tox)

    assert sim_tox["pk_summary"]["cmax_mg_l"] > sim_std["pk_summary"]["cmax_mg_l"] * 3.0
    assert sim_tox["pk_summary"]["min_hepatic_gsh_pct"] < 30.0
    assert sim_tox["organs"]["liver"]["peak_risk_pct"] > sim_std["organs"]["liver"]["peak_risk_pct"]


def test_gentamicin_renal_impairment_sensitivity():
    genta = DRUG_DATABASE["gentamicin"]
    p_normal = PatientProfile(serum_creatinine_mg_dl=0.85)
    p_ckd = PatientProfile(age=74, serum_creatinine_mg_dl=2.8)
    reg = DosingRegimen(drug_id="gentamicin", route="iv_bolus", dose_mg=240.0, interval_h=12.0, num_doses=3)

    sim_normal = simulate_pkpd_and_organs(drug=genta, patient=p_normal, regimen=reg)
    sim_ckd = simulate_pkpd_and_organs(drug=genta, patient=p_ckd, regimen=reg)

    assert sim_ckd["pk_summary"]["auc_0_t_mg_h_l"] > sim_normal["pk_summary"]["auc_0_t_mg_h_l"] * 1.5
    assert sim_ckd["organs"]["kidney"]["peak_risk_pct"] > sim_normal["organs"]["kidney"]["peak_risk_pct"]


def test_dapsone_g6pd_deficiency_hemolysis():
    dapsone = DRUG_DATABASE["dapsone"]
    p_normal = PatientProfile(g6pd_status="normal")
    p_g6pd = PatientProfile(g6pd_status="deficient")
    reg = DosingRegimen(drug_id="dapsone", route="oral", dose_mg=200.0, interval_h=12.0, num_doses=2)

    sim_normal = simulate_pkpd_and_organs(drug=dapsone, patient=p_normal, regimen=reg)
    sim_g6pd = simulate_pkpd_and_organs(drug=dapsone, patient=p_g6pd, regimen=reg)

    assert sim_g6pd["organs"]["blood"]["peak_risk_pct"] > sim_normal["organs"]["blood"]["peak_risk_pct"]


def test_fastapi_endpoints_and_verification_loop():
    # 1. Health check
    r_health = client.get("/healthz")
    assert r_health.status_code == 200
    assert r_health.json()["status"] == "ok"

    # 2. Drugs list
    r_drugs = client.get("/api/drugs")
    assert r_drugs.status_code == 200
    data_drugs = r_drugs.json()
    assert len(data_drugs["preset_drugs"]) == 6
    assert len(data_drugs["novel_drug_samples"]) == 4

    # 3. Simulate endpoint (Terfenadine + CYP3A4 inhibitor + LQT2 variant)
    r_sim = client.post(
        "/api/simulate",
        json={
            "drug_id": "terfenadine",
            "route": "oral",
            "dose_mg": 180.0,
            "interval_h": 8.0,
            "num_doses": 3,
            "duration_h": 24.0,
            "patient": {
                "age": 28,
                "sex": "F",
                "weight_kg": 58.0,
                "serum_creatinine_mg_dl": 0.85,
                "cyp3a4_phenotype": "inhibited",
                "kcnh2_herg_variant": "lqt2_carrier",
            },
        },
    )
    assert r_sim.status_code == 200
    sim_payload = r_sim.json()
    assert sim_payload["verification_loop"]["all_passed"] is True
    assert sim_payload["verification_loop"]["passed_count"] == 5
    assert sim_payload["simulation"]["organs"]["heart"]["peak_risk_pct"] > 50.0

    # 4. Phase 2 AlphaFold 3 Novel Drug Approximator endpoint
    r_af3 = client.post(
        "/api/af3-approximate",
        json={
            "molecule_name": "Paraquat",
            "smiles": "C[N+]1=CC=C(C=C1)C2=CC=[N+](C=C2)C",
            "route": "oral",
            "dose_mg": 300.0,
            "interval_h": 12.0,
            "num_doses": 2,
        },
    )
    assert r_af3.status_code == 200
    af3_payload = r_af3.json()
    assert af3_payload["verification_loop"]["all_passed"] is True
    assert af3_payload["approximated_drug_profile"]["af3_confidence"]["iptm"] > 0.7

    # 5. Human-in-the-Loop Clinical Approval endpoint
    r_gate = client.post(
        "/api/verify-protocol",
        json={
            "simulation_id": sim_payload["simulation_id"],
            "reviewer_name": "PharmD Candidate",
            "decision": "approved_with_monitoring",
            "clinical_notes": "ECG QTc monitoring + IV MgSO4 standby verified.",
        },
    )
    assert r_gate.status_code == 200
    assert r_gate.json()["status"] == "verified"

    # 6. Photo upload endpoint with existing user_avatar.jpg
    avatar_file = Path(__file__).resolve().parent.parent / "static" / "assets" / "user_avatar.jpg"
    if avatar_file.exists():
        with open(avatar_file, "rb") as f:
            r_photo = client.post(
                "/api/upload-photo",
                files={"file": ("user_avatar.jpg", f, "image/jpeg")},
            )
        assert r_photo.status_code == 200
        assert "face_uv_url" in r_photo.json()

    # 7. Verify Frontend HTML (Onboarding + Selective Overlays), Architecture Diagram & 2-Mode 3D Hologram Script
    r_index = client.get("/")
    assert r_index.status_code == 200
    assert "PharmacoTwin 3D" in r_index.text
    assert "onboarding-screen" in r_index.text
    assert "overlay-window" in r_index.text
    assert "body3d-canvas-container" in r_index.text
    assert "user_face_uv.jpg" not in r_index.text

    r_arch = client.get("/architecture")
    assert r_arch.status_code == 200
    assert "Multi-Scale Architecture" in r_arch.text

    r_js = client.get("/static/js/body3d.js")
    assert r_js.status_code == 200
    assert "pipe_circuit" in r_js.text
    assert "warpToOrgan" in r_js.text
    assert "user_face_uv.jpg" not in r_js.text


