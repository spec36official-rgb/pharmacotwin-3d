# PharmacoTwin 3D — Multi-Scale 3D Pharmacokinetic/Pharmacodynamic (PK/PD) & Structural Toxicity Simulator

**Track 2: Hard Tech (Biotech, Physics & Molecular Simulation)**  
*Built for the Google DeepMind AI Hackathon (Seoul, 2026-10-16) using **Gemini 4 Argon (`gemini-4-argon`)**, **AlphaFold 3 Co-Folding**, and **Antigravity**.*

---

## 1. Problem & Impact

Preclinical drug researchers, clinical pharmacists, and pharmacy students face a critical gap between **atomic-scale structural biology** (how a drug binds an off-target receptor pocket in 3D) and **whole-body clinical toxicokinetics** (how plasma and organ concentrations evolve over 24 hours across diverse patient genotypes and renal/hepatic states).

**PharmacoTwin 3D** bridges this multi-scale gap in a single interactive 3D WebGL Digital Twin:
1. **Phase 1 — Multi-Compartment PK/PD & 8-Organ 3D Digital Twin**: Solves coupled 2-compartment differential equations (`scipy.integrate.solve_ivp` RK45) with GI absorption ($k_a, F$), portal first-pass hepatic Glutathione (GSH) depletion, and effect-compartment biophase lag ($k_{e0}$), mapped in real time onto an interactive **Three.js 3D Human Digital Twin** (featuring the user's portrait UV-mapped directly onto the 3D cranial mesh, animated Oral pill swallowing and IV syringe injection, 320 circulating bloodstream particles, and 8 clickable internal organs).
2. **Phase 2 — AlphaFold 3 Structure-to-PK/PD Novel Drug Approximator**: For unprofiled or novel chemical entities (input via SMILES), generates an official **AlphaFold 3** receptor-ligand co-folding job specification, approximates 3D binding-pocket atomic contact distances ($r_{ij}$ in $\text{\AA}$), and converts them via a **12-6 Lennard-Jones + Screened Coulomb thermodynamic engine** into Gibbs free energy ($\Delta G_{\text{bind}}$), dissociation constant ($K_d = \exp(\Delta G / RT)$), and organ toxicity thresholds ($EC_{50,\text{tox}}$).
3. **Phase 3 — Pharmacogenomics (PGx) & Regulatory Personalization**: Simulates patient-specific susceptibility across `CYP2E1` (NAPQI induction), `CYP3A4` (first-pass inhibition / poor metabolizers), `KCNH2/hERG` (LQT2 arrhythmia carrier), `G6PD` deficiency (oxidative Heinz-body hemolysis), and Cockcroft-Gault renal clearance ($\text{CrCl}$).

---

## 2. Why Gemini 4 Argon (`gemini-4-argon`) Is Essential

- **1M-Token Context Window Grounding**: Holds the full 7-week Pharmacy Toxicology Curriculum (covering 4-Step Toxicity Cascades, Zone 3 CYP2E1/NAPQI/JNK signaling, PCT Megalin/OCT2 nephrotoxicity, Methemoglobinemia/G6PD hemolysis, hERG $K_v11.1$ EAD/TdP, neuropathies, and pulmonary fibrosis) alongside live 2-compartment ODE trajectories and 3D PDB pocket coordinates.
- **Closed-Loop Deterministic Verification Engine (5/5 Pass/Fail Checks)**: Every simulation and AlphaFold 3 approximation passes a mandatory 5-point mathematical verification loop before rendering:
  1. `THERMO_GIBBS_CONSISTENCY`: Verifies $\Delta G = R \cdot T \cdot \ln(K_d)$ at $310.15\text{ K}$.
  2. `PK_ODE_STABILITY`: Verifies non-negative compartmental masses and micro-rate constants ($k_{10}, k_{12}, k_{21} > 0$).
  3. `RENAL_CRCL_PHYSIOLOGY`: Verifies Cockcroft-Gault $\text{CrCl}$ scaling and clearance additivity ($CL_{\text{total}} = CL_R + CL_H$).
  4. `MULTI_ORGAN_TOX_MAPPING`: Verifies 8-organ partition coefficients ($K_p$) and Hill equation bounds ($[0\%, 100\%]$).
  5. `HUMAN_IN_THE_LOOP_SAFEGUARD`: Enforces a mandatory Clinical/PharmD Safety Verification Gate before protocol sign-off.

---

## 3. Quick Start & Verification

### Local Execution
```bash
# 1. Install dependencies
python -X utf8 -m pip install -r requirements.txt

# 2. (Optional) Regenerate 3D UV face texture from user photo
python -X utf8 scripts/prepare_assets.py

# 3. Run the automated verification test suite (6/6 tests)
python -X utf8 -m pytest -v

# 4. Launch the FastAPI + WebGL 3D server
python -X utf8 -m uvicorn backend.main:app --host 0.0.0.0 --port 8080
```
Then open `http://localhost:8080` in your browser (and `http://localhost:8080/architecture` for the interactive architecture diagram).

### Google Cloud Run Deployment
```bash
gcloud run deploy pharmacotwin-3d \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --set-env-vars="ARGON_MODEL_ID=gemini-4-argon"
```
