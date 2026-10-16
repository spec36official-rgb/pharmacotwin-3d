# AGENTS.md — PharmacoTwin 3D Engineering & Operational Notes

## 1. Environment & SDK Quirks
- **Python Version**: Python 3.14.6 (`numpy 2.4.6`, `scipy 1.18.0`, `pillow 12.3.0`).
- **Windows Console UTF-8**: PowerShell defaults to CP949/EUC-KR in Korean locales, which garbles Korean filenames (`내사진.jpg`, `독성학강의/*.pdf`). Always invoke Python with `python -X utf8` when reading/writing filesystem paths or logs.
- **Gemini 4 Argon (`gemini-4-argon`) Interactions API**:
  - Requires `google-genai >= 2.3.0`.
  - Use `client.interactions.create(model="gemini-4-argon", input=..., generation_config={"thinking_level": "medium" | "high"})`.
  - **NEVER** pass `temperature`, `top_p`, `top_k`, or `thinking_budget` to `gemini-4-argon` (deprecated/ignored and may raise validation errors).
  - Do not send explicit `cached_content`; implicit caching is automatic across the 1M-token window.
  - Timeouts: `genai.types.HttpOptions(timeout=...)` is in **milliseconds**; the per-call `interactions.create(..., timeout=...)` is in **seconds** (httpx request option, not a generation parameter).
- **Tests are offline**: `tests/conftest.py` removes `GEMINI_API_KEY`/`GOOGLE_API_KEY` and stubs the AlphaFold DB and UniProt fetches. Fake Argon clients are installed by monkeypatching `google.genai.Client`.
- **AF3 target sequences**: parsed from CA `ATOM` records of `static/assets/alphafold_pdb/*_<UNIPROT>.pdb` (indexed by `alphafold_structures.json`), else UniProt REST FASTA (3 s timeout, cached; failures retried after 5 min), else `sequence: null` + `sequence_source: "unavailable"`. Template UniProt IDs Q02880, P16435, O00764 have no bundled PDB.
- **User Photo (`내사진.jpg`) Orientation**:
  - The raw image `내사진.jpg` is stored rotated 90° counter-clockwise (landscape $2560 \times 1920$ or similar with head pointing left).
  - Pre-processing script `scripts/prepare_assets.py` rotates the image 270° (90° clockwise) to upright portrait orientation and crops a normalized square face map (`static/assets/user_face_uv.jpg`) for Three.js 3D head mesh UV mapping and profile display (`static/assets/user_avatar.jpg`).

## 2. Mathematical & Simulation Safeguards
- **Singularity Prevention in Oral PK**:
  - Closed-form 1-compartment oral equation $C(t) = \frac{F \cdot D \cdot k_a}{V_d (k_a - k_e)}(e^{-k_e t} - e^{-k_a t})$ divides by zero when $k_a = k_e$ (flip-flop kinetics).
  - We solve the coupled 2-compartment + GI absorption + effect compartment ODE system numerically via `scipy.integrate.solve_ivp` (RK45) and provide an exact analytical limit fallback $t \cdot e^{-k_e t}$ if $|k_a - k_e| < 10^{-6}$.
- **Thermodynamic Binding-to-PD Scaling**:
  - $\Delta G_{\text{binding}}$ (kcal/mol) relates to dissociation constant via $K_d = \exp\left(\frac{\Delta G}{R \cdot T}\right)$ where $R = 1.987 \times 10^{-3}\text{ kcal/(mol}\cdot\text{K)}$ and $T = 310.15\text{ K}$ ($37^\circ\text{C}$, physiological temperature, $RT \approx 0.6163\text{ kcal/mol}$).
  - Converting Molar $K_d$ to clinical mass concentration ($\text{mg/L}$ or $\mu\text{g/mL}$) requires multiplying by Molecular Weight ($\text{MW}$ in $\text{g/mol}$) and unbound plasma fraction ($f_u$): $EC_{50,\text{total}} \approx \frac{K_d \cdot \text{MW}}{f_u}$.
- **Human-in-the-Loop Clinical/Research Safeguard**:
  - All toxicity predictions, dose adjustments, and PGx simulations require explicit user verification via the **Clinical/Researcher Verification Gate** before exporting or locking simulation protocols.
  - `/api/simulate` and `/api/af3-approximate` always return `requires_human_approval: true` (no risk threshold). `/api/verify-protocol` rejects (422) a blank `reviewer_name` or a missing/unknown `decision` (`approved | approved_with_monitoring | needs_revision | rejected`, optional matching `approved` bool).
- **Argon claim checking**: `ARGON_CLAIM_CONSISTENCY` only scans numbers immediately followed by `mg/L`, `h`, `%`, or `mL/min` in the English `executive_summary`; numbers glued to letters (`q8h`, `k10`) and rate units (`h⁻¹`, `h-1`) are deliberately ignored. Allowed values come from scalar `sim_result` keys by suffix (`_mg_l`, `_pct`, `_ml_min`, `_h` except `k*_h` / `*_l_h`); timeline arrays are excluded so the check stays meaningful.
