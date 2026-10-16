# PharmacoTwin 3D — Multi-Scale PK/PD & Structural Toxicity Simulator

**Track 2: Hard Tech (Biotech, Physics & Molecular Simulation)**  
*Built for the Google DeepMind AI Hackathon (Seoul, 2026-10-16) with **Gemini 4 Argon (`gemini-4-argon`)**, **AlphaFold DB / AlphaFold 3 input jobs**, and **Antigravity**.*

---

## 1. Problem & Impact

Preclinical researchers, clinical pharmacists, and pharmacy students face a gap between **atomic-scale structural biology** (how a drug binds an off-target pocket) and **whole-body toxicokinetics** (how plasma and organ concentrations evolve over 24 hours across genotypes and renal/hepatic states).

**PharmacoTwin 3D** puts both scales in one interactive 3D view:

1. **Phase 1 — Multi-compartment PK/PD and an 8-organ 3D body**: solves coupled 2-compartment ODEs (`scipy.integrate.solve_ivp`, RK45) with GI absorption ($k_a, F$), hepatic first-pass glutathione (GSH) depletion, and an effect compartment ($k_{e0}$). Results drive a Three.js body with 8 clickable organs (liver, kidney, heart, brain, lungs, blood, eyes, GI), oral/IV administration animation, and free orbit/pan/zoom.
2. **Phase 2 — Novel compounds from SMILES**: generates an **AlphaFold 3 input job** (target protein sequence from the bundled AlphaFold DB model or UniProt + ligand SMILES) and a **heuristic structure-informed PK/PD estimate**. **AlphaFold 3 is not executed**: pocket contacts come from a fixed template, PK parameters from SMILES descriptors (or lecture template values), and the energy terms from a 12-6 Lennard-Jones + screened Coulomb model → $\Delta G_{\text{bind}}$ → $K_d = \exp(\Delta G / RT)$ → $EC_{50,\text{tox}}$. Responses are labelled `method: "heuristic_estimate"`, ipTM is `null`, and the job JSON can be submitted to AlphaFold 3 as-is.
3. **Phase 3 — Pharmacogenomics and patient factors**: `CYP2E1` induction (NAPQI), `CYP3A4` inhibition / poor metabolizers, `KCNH2/hERG` LQT2 carriers, `G6PD` deficiency (oxidative hemolysis), and Cockcroft-Gault renal clearance ($\text{CrCl}$).

---

## 2. Gemini 4 Argon and the Verification Loop

- **Curriculum-grounded interpretation**: Argon receives the 7-module toxicology curriculum plus the live simulation numbers and returns a bilingual (English/Korean) interpretation, a 4-step toxicity cascade, an antidote plan, and a structured `claims` object (`cmax_mg_l`, `tmax_h`, `auc_0_t_mg_h_l`, `primary_alert_organ`, `primary_peak_risk_pct`, `crcl_ml_min`).
- **6-check deterministic verification loop** runs on every simulation and AF3 estimate:
  1. `THERMO_GIBBS_CONSISTENCY` — $\Delta G = R \cdot T \cdot \ln(K_d)$ at $310.15\text{ K}$.
  2. `PK_ODE_STABILITY` — non-negative concentrations and positive micro-rate constants ($k_{10}, k_{12}, k_{21}$).
  3. `RENAL_CRCL_PHYSIOLOGY` — Cockcroft-Gault $\text{CrCl}$ range and $CL_{\text{total}} = CL_R + CL_H$.
  4. `MULTI_ORGAN_TOX_MAPPING` — 8 organs, Hill-equation risk bounded to $[0\%, 100\%]$.
  5. `HUMAN_IN_THE_LOOP_SAFEGUARD` — the human sign-off gate is active.
  6. `ARGON_CLAIM_CONSISTENCY` — every structured claim must match the simulation (±5%, organ exact), and every number in the English summary tagged mg/L, h, % or mL/min must match a simulated value.
- **Retry with correction**: if check 6 fails, Argon is re-prompted with the exact mismatches and the correct values (up to 3 attempts, ~90 s total budget, HTTP timeout on the client). Each attempt is recorded in `verification_loop.attempts` (`iteration`, `passed`, `failed_check_ids`). If Argon never passes, the deterministic template narrative is used instead and the same checker verifies it.
- **Honest labels**: `argon_analysis.argon_called` is `true` only when Argon responded; `model_used` reads `gemini-4-argon (Interactions API)` only when Argon text is shown, otherwise `Deterministic template (Argon not called: no API key)`, `Deterministic template (Argon call failed: <error>)`, or `Deterministic template (Argon output failed claim verification …)`.
- **Human sign-off for every simulation**: every response carries `requires_human_approval: true`. Export is locked until a named reviewer records an explicit decision (`approved`, `approved_with_monitoring`, `needs_revision`, `rejected`) via `POST /api/verify-protocol`; every decision is kept in the audit log.

---

## 3. Quick Start & Verification

### Local Execution
```bash
# 1. Install dependencies
python -X utf8 -m pip install -r requirements.txt

# 2. Run the automated test suite (offline; network and Gemini calls are stubbed)
python -X utf8 -m pytest -q

# 3. (Optional) enable live Gemini 4 Argon interpretation
export GEMINI_API_KEY=...        # PowerShell: $env:GEMINI_API_KEY="..."

# 4. Launch the FastAPI + WebGL server
python -X utf8 -m uvicorn backend.main:app --host 0.0.0.0 --port 8080
```
Then open `http://localhost:8080` (and `http://localhost:8080/architecture` for the architecture diagram).

Without an API key the app runs fully on the deterministic template narrative, labelled as such.

### Google Cloud Run Deployment
```bash
gcloud run deploy pharmacotwin-3d \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --set-env-vars="ARGON_MODEL_ID=gemini-4-argon"
```
