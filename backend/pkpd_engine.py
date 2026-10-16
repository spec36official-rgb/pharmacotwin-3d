"""
Multi-Scale 2-Compartment PK/PD, Thermodynamic Receptor Binding (DeltaG -> Kd -> EC50),
and 8-Organ Toxicology Simulation Engine for PharmacoTwin 3D.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Any
import numpy as np
from scipy.integrate import solve_ivp
from pydantic import BaseModel, Field


# Physical constants at physiological temperature (37 C = 310.15 K)
R_KCAL_MOL_K = 1.98720425864083e-3  # kcal / (mol * K)
T_PHYSIOL_K = 310.15                # 37.0 C in Kelvin
RT_PHYSIOL = R_KCAL_MOL_K * T_PHYSIOL_K  # ~0.61633 kcal/mol


class PatientProfile(BaseModel):
    name: str = Field(default="Pharmacy Researcher (Digital Twin)")
    age: int = Field(default=24, ge=1, le=110)
    sex: str = Field(default="M", pattern="^(M|F)$")
    weight_kg: float = Field(default=68.0, gt=10.0, le=250.0)
    height_cm: float = Field(default=175.0, gt=50.0, le=230.0)
    serum_creatinine_mg_dl: float = Field(default=0.95, gt=0.1, le=15.0)
    hepatic_function: str = Field(default="normal")  # normal, mild_impairment, moderate_impairment, severe_impairment
    albumin_g_dl: float = Field(default=4.2, gt=1.0, le=6.5)
    # Phase 3: Pharmacogenomics (PGx) / AlphaGenome Regulatory Profile
    cyp2e1_phenotype: str = Field(default="normal")      # normal, induced (alcohol/isoniazid), rapid
    cyp3a4_phenotype: str = Field(default="normal")      # normal, inhibited (ketoconazole/grapefruit), poor
    kcnh2_herg_variant: str = Field(default="wildtype")  # wildtype, lqt2_carrier (sensitized hERG)
    g6pd_status: str = Field(default="normal")           # normal, deficient (hemolysis risk)


class DosingRegimen(BaseModel):
    drug_id: str = Field(default="acetaminophen")
    route: str = Field(default="oral")  # oral, iv_bolus, iv_infusion
    dose_mg: float = Field(default=500.0, gt=0.1, le=50000.0)
    infusion_duration_h: float = Field(default=0.5, ge=0.0, le=24.0)
    interval_h: float = Field(default=8.0, gt=0.5, le=72.0)
    num_doses: int = Field(default=1, ge=1, le=14)
    duration_h: float = Field(default=24.0, ge=4.0, le=120.0)


def compute_cockcroft_gault_crcl(patient: PatientProfile) -> float:
    """Compute Creatinine Clearance (CrCl in mL/min) using the Cockcroft-Gault equation."""
    sex_factor = 0.85 if patient.sex.upper() == "F" else 1.0
    crcl = ((140.0 - patient.age) * patient.weight_kg) / (72.0 * patient.serum_creatinine_mg_dl) * sex_factor
    return round(max(5.0, min(220.0, crcl)), 2)


def compute_bsa_mosteller(patient: PatientProfile) -> float:
    """Compute Body Surface Area (m^2) via Mosteller formula."""
    return round(math.sqrt((patient.height_cm * patient.weight_kg) / 3600.0), 2)


def compute_thermodynamic_affinity(
    contacts: List[Dict[str, float]],
    buried_hydrophobic_area_a2: float,
    hbond_count: int,
    rotatable_bonds: int,
    mw_g_mol: float,
    fu_plasma: float,
    endogenous_competition_ratio: float = 0.2,
) -> Dict[str, float]:
    """
    Convert atomic contact distances r_ij (Angstroms) and pocket surface features from
    AlphaFold 3 / PDB co-folding structures into:
      1) DeltaG_binding (kcal/mol) via Lennard-Jones 12-6 + Coulomb + H-bond + Hydrophobic + Rotor terms
      2) Dissociation constant Kd (M and uM) via Gibbs free energy: Kd = exp(DeltaG / (R * T))
      3) Effective toxicity threshold EC50_tox (mg/L) via Cheng-Prusoff & plasma protein binding adjustment
    """
    vdw_kcal = 0.0
    elec_kcal = 0.0

    for c in contacts:
        r = max(1.8, float(c.get("distance_a", 3.6)))
        r0 = float(c.get("r0_a", 3.6))
        eps = float(c.get("eps_kcal", 0.22))
        q1 = float(c.get("q1", 0.0))
        q2 = float(c.get("q2", 0.0))

        # 12-6 Lennard-Jones potential (capped against steric clash spikes in static coordinates)
        sr = r0 / r
        lj = eps * (min(4.0, sr ** 12) - 2.0 * (sr ** 6))
        vdw_kcal += lj

        # Screened Coulomb electrostatic interaction inside binding pocket (dielectric ~ 20)
        elec_kcal += (332.0 * q1 * q2) / (20.0 * r)

    # Empirical desolvation / H-bond / conformational entropy contributions
    delta_g_hbond = -0.85 * hbond_count
    delta_g_hydrophobic = -0.028 * buried_hydrophobic_area_a2
    delta_g_rotor = 0.32 * rotatable_bonds

    delta_g_total = vdw_kcal + elec_kcal + delta_g_hbond + delta_g_hydrophobic + delta_g_rotor
    # Clamp within physiological small-molecule off-target binding range [-10.8, -4.5] kcal/mol
    delta_g_total = max(-10.8, min(-4.5, delta_g_total))

    # Kd in Molar (M): DeltaG = R * T * ln(Kd) => Kd = exp(DeltaG / RT)
    kd_molar = math.exp(delta_g_total / RT_PHYSIOL)
    kd_um = kd_molar * 1e6

    # Cheng-Prusoff mapping from unbound Kd at target site to total plasma EC50 (mg/L)
    # EC50_unbound (M) = Kd * (1 + [S]/Km)
    ec50_unbound_m = kd_molar * (1.0 + endogenous_competition_ratio)
    # Convert M (mol/L) -> mg/L: multiply by MW (g/mol = mg/mmol) * 1000 mg/g, then divide by fu
    ec50_total_mg_l = (ec50_unbound_m * mw_g_mol * 1000.0) / max(0.01, fu_plasma)

    return {
        "vdw_kcal_mol": round(vdw_kcal, 3),
        "electrostatic_kcal_mol": round(elec_kcal, 3),
        "hbond_kcal_mol": round(delta_g_hbond, 3),
        "hydrophobic_kcal_mol": round(delta_g_hydrophobic, 3),
        "rotor_penalty_kcal_mol": round(delta_g_rotor, 3),
        "delta_g_kcal_mol": round(delta_g_total, 3),
        "kd_molar": float(f"{kd_molar:.6e}"),
        "kd_um": round(max(1e-4, kd_um), 4),
        "ec50_tox_mg_l": round(max(1e-3, ec50_total_mg_l), 4),
    }


def simulate_pkpd_and_organs(
    drug: Dict[str, Any],
    patient: PatientProfile,
    regimen: DosingRegimen,
) -> Dict[str, Any]:
    """
    Solve the coupled 2-Compartment PK + GI Absorption + Effect Compartment + Toxic Metabolite
    ODE system and compute time-resolved concentrations and toxicity indices across 8 human organs.
    """
    crcl = compute_cockcroft_gault_crcl(patient)
    bsa = compute_bsa_mosteller(patient)
    weight_scale = patient.weight_kg / 70.0

    # Base drug PK parameters (normalized for a 70kg reference human)
    vc_base = float(drug["pk"]["vc_l_per_70kg"]) * weight_scale
    vp_base = float(drug["pk"]["vp_l_per_70kg"]) * weight_scale
    cl_base = float(drug["pk"]["cl_l_h_per_70kg"]) * (weight_scale ** 0.75)
    q_base = float(drug["pk"]["q_l_h_per_70kg"]) * (weight_scale ** 0.75)
    ka = float(drug["pk"]["ka_h"])
    f_bio = float(drug["pk"]["f_oral"])
    ke0 = float(drug["pk"]["ke0_h"])
    fe_renal = float(drug["pk"]["fe_renal"])  # Fraction excreted unchanged in urine (0..1)
    fu_plasma = float(drug["pk"]["fu_plasma"])

    # Adjust hepatic & renal clearance based on patient physiology & PGx
    renal_factor = crcl / 100.0
    hepatic_map = {
        "normal": 1.0,
        "mild_impairment": 0.75,
        "moderate_impairment": 0.50,
        "severe_impairment": 0.28,
    }
    hepatic_factor = hepatic_map.get(patient.hepatic_function, 1.0)

    # CYP3A4 / PGx modifiers
    cyp3a4_substrate = bool(drug["pk"].get("cyp3a4_substrate", False))
    if cyp3a4_substrate:
        if patient.cyp3a4_phenotype == "inhibited":
            hepatic_factor *= 0.22  # Strong CYP3A4 inhibition (e.g., Ketoconazole / Grapefruit) -> 4.5x exposure!
            f_bio = min(0.95, f_bio * 2.4)  # Reduced first-pass extraction
        elif patient.cyp3a4_phenotype == "poor":
            hepatic_factor *= 0.45
            f_bio = min(0.90, f_bio * 1.6)

    # High-dose saturation (Michaelis-Menten / Sulfation & Glucuronidation saturation for Acetaminophen)
    single_dose_mg = regimen.dose_mg
    total_daily_dose_mg = single_dose_mg * (24.0 / max(1.0, regimen.interval_h)) if regimen.num_doses > 1 else single_dose_mg
    metabolic_saturation_factor = 1.0
    if drug["id"] == "acetaminophen" and (single_dose_mg >= 2000.0 or total_daily_dose_mg >= 4000.0):
        # Glucuronidation & sulfation saturate above 4g/day; elimination slows and CYP2E1 flux surges
        overload_ratio = max(single_dose_mg / 2000.0, total_daily_dose_mg / 4000.0)
        metabolic_saturation_factor = max(0.38, 1.0 / (0.65 + 0.35 * overload_ratio))

    # Effective systemic clearance CL = CL_renal + CL_hepatic
    cl_renal = cl_base * fe_renal * renal_factor
    cl_hepatic = cl_base * (1.0 - fe_renal) * hepatic_factor * metabolic_saturation_factor
    cl_eff = max(0.05, cl_renal + cl_hepatic)

    # Micro-rate constants (h^-1)
    k10 = cl_eff / vc_base
    k12 = q_base / vc_base
    k21 = q_base / vp_base
    t_half_alpha_beta = round(0.693 * (vc_base + vp_base) / cl_eff, 2)

    # Reactive metabolite formation rate (e.g. CYP2E1 -> NAPQI for Acetaminophen)
    f_tox_met_base = float(drug["pk"].get("f_toxic_metabolite", 0.05))
    if patient.cyp2e1_phenotype == "induced":
        f_tox_met_base *= 2.3  # Chronic ethanol / isoniazid induces CYP2E1
    if drug["id"] == "acetaminophen" and (single_dose_mg >= 2000.0 or total_daily_dose_mg >= 4000.0):
        f_tox_met_base *= 2.8  # Shunting to CYP2E1 when phase II conjugation saturates

    # Build time grid (step = 0.1h for smooth 60fps UI scrubbing)
    t_end = float(regimen.duration_h)
    dt = 0.1
    t_eval = np.round(np.arange(0.0, t_end + dt / 2, dt), 2)

    # Dosing events at t = 0, interval, 2*interval, ...
    dose_times = [i * regimen.interval_h for i in range(regimen.num_doses) if i * regimen.interval_h < t_end]

    # State vector y = [A_gi (mg), A_central (mg), A_peripheral (mg), C_effect (mg/L), A_metabolite (mg), GSH_reserve (0..1)]
    y_current = np.array([0.0, 0.0, 0.0, 0.0, 0.0, 1.0], dtype=float)

    # Apply initial bolus at t=0 if oral or iv_bolus
    if 0.0 in dose_times:
        if regimen.route == "oral":
            y_current[0] += regimen.dose_mg * f_bio
        elif regimen.route == "iv_bolus":
            y_current[1] += regimen.dose_mg

    def iv_infusion_rate(t_val: float) -> float:
        if regimen.route != "iv_infusion":
            return 0.0
        dur = max(0.08, regimen.infusion_duration_h)
        rate = 0.0
        for dt_start in dose_times:
            if dt_start <= t_val <= dt_start + dur:
                rate += regimen.dose_mg / dur
        return rate

    def ode_rhs(t_val: float, y: np.ndarray) -> np.ndarray:
        a_gi, a_c, a_p, c_e, a_met, gsh = y
        c_c = max(0.0, a_c / vc_base)
        c_p = max(0.0, a_p / vp_base)

        # GI absorption
        da_gi = -ka * a_gi
        absorption_rate = ka * a_gi

        # Central & Peripheral compartments
        inf_rate = iv_infusion_rate(t_val)
        da_c = absorption_rate + inf_rate - (k10 + k12) * a_c + k21 * a_p
        da_p = k12 * a_c - k21 * a_p

        # Effect compartment (biophase lag)
        dc_e = ke0 * (c_c - c_e)

        # Toxic metabolite kinetics & Hepatic Glutathione (GSH) conjugation/depletion
        met_formation = k10 * a_c * f_tox_met_base
        # When GSH > 0.30, reactive metabolite is detoxified rapidly; below 0.30 (70% depletion), covalent binding spikes!
        detox_rate = (1.8 * gsh + 0.12) * a_met
        da_met = met_formation - detox_rate

        # GSH turnover: consumed by toxic metabolite, regenerated at basal rate k_syn
        gsh_consumption = 0.0018 * met_formation if drug["id"] == "acetaminophen" else 0.0003 * met_formation
        gsh_regen = 0.08 * (1.0 - gsh)
        dgsh = gsh_regen - gsh_consumption
        if gsh <= 0.02 and dgsh < 0:
            dgsh = 0.0

        return np.array([da_gi, da_c, da_p, dc_e, da_met, dgsh])

    # Integrate segment by segment across multiple doses
    all_t: List[float] = []
    all_y: List[np.ndarray] = []

    segment_boundaries = sorted(list(set([0.0] + [d for d in dose_times if 0.0 < d < t_end] + [t_end])))
    for idx in range(len(segment_boundaries) - 1):
        t0, t1 = segment_boundaries[idx], segment_boundaries[idx + 1]
        if idx > 0 and t0 in dose_times:
            if regimen.route == "oral":
                y_current[0] += regimen.dose_mg * f_bio
            elif regimen.route == "iv_bolus":
                y_current[1] += regimen.dose_mg

        seg_t = t_eval[(t_eval >= t0) & (t_eval <= t1)]
        if len(seg_t) == 0:
            continue
        sol = solve_ivp(ode_rhs, (t0, t1), y_current, t_eval=seg_t, method="RK45", rtol=1e-6, atol=1e-8)
        for j in range(len(sol.t)):
            if len(all_t) > 0 and abs(sol.t[j] - all_t[-1]) < 1e-5:
                continue
            all_t.append(float(round(sol.t[j], 2)))
            all_y.append(sol.y[:, j])
        y_current = sol.y[:, -1].copy()

    # Extract PK/PD arrays
    t_arr = np.array(all_t)
    y_mat = np.column_stack(all_y)

    a_gi_arr = np.maximum(0.0, y_mat[0])
    c_central_arr = np.maximum(0.0, y_mat[1] / vc_base)
    c_periph_arr = np.maximum(0.0, y_mat[2] / vp_base)
    c_effect_arr = np.maximum(0.0, y_mat[3])
    c_met_arr = np.maximum(0.0, y_mat[4] / (vc_base * 0.25))
    gsh_arr = np.clip(y_mat[5], 0.02, 1.0)

    # PD Efficacy: Sigmoid Emax Hill Equation on Effect Compartment Concentration Ce(t)
    ec50_eff = float(drug["pd"]["ec50_efficacy_mg_l"])
    emax_eff = float(drug["pd"]["emax_efficacy_pct"])
    hill_n = float(drug["pd"].get("hill_n", 1.2))
    efficacy_arr = (emax_eff * (c_effect_arr ** hill_n)) / ((ec50_eff ** hill_n) + (c_effect_arr ** hill_n) + 1e-12)

    # Compute Thermodynamic Receptor Binding for Primary Toxicity Target
    thermo = compute_thermodynamic_affinity(
        contacts=drug["structure_3d"]["pocket_contacts"],
        buried_hydrophobic_area_a2=drug["structure_3d"]["buried_area_a2"],
        hbond_count=drug["structure_3d"]["hbond_count"],
        rotatable_bonds=drug["structure_3d"]["rotatable_bonds"],
        mw_g_mol=drug["mw_g_mol"],
        fu_plasma=fu_plasma,
    )

    # 8-Organ Partitioning (Kp) & Toxicity Risk Computation
    organ_defs = drug["organ_profiles"]
    organ_timeseries: Dict[str, Dict[str, Any]] = {}
    peak_organ_risks: Dict[str, float] = {}

    for organ_key, ocfg in organ_defs.items():
        kp = float(ocfg["kp_partition"])
        compartment_ref = ocfg.get("compartment", "central")
        ec50_tox = float(ocfg["ec50_tox_mg_l"])
        hill_tox = float(ocfg.get("hill_tox", 1.5))

        # Apply PGx patient susceptibility modifiers to specific organs
        if organ_key == "heart" and patient.kcnh2_herg_variant == "lqt2_carrier":
            ec50_tox *= 0.35  # LQT2 / KCNH2 mutation lowers hERG arrhythmia threshold
        if organ_key == "blood" and patient.g6pd_status == "deficient":
            ec50_tox *= 0.30  # G6PD deficiency sensitizes erythrocytes to oxidative hemolysis

        # Base driving concentration for this organ
        if compartment_ref == "gi":
            c_organ = (a_gi_arr / 1.5) * 0.15 + c_central_arr * kp * 0.25
        elif compartment_ref == "portal_liver":
            # Liver sees portal first-pass spike during oral absorption + systemic + reactive metabolite
            portal_spike = (ka * a_gi_arr) / max(10.0, cl_eff * 2.5)
            gsh_penalty = np.where(gsh_arr < 0.35, 1.0 + (0.35 - gsh_arr) * 6.5, 1.0)
            c_organ = (c_central_arr * kp + portal_spike + c_met_arr * 2.2) * gsh_penalty
        elif compartment_ref == "peripheral":
            c_organ = c_periph_arr * kp
        else:
            c_organ = c_central_arr * kp

        # Hill equation for organ toxicity risk (0..100%)
        tox_pct = 100.0 * (c_organ ** hill_tox) / ((ec50_tox ** hill_tox) + (c_organ ** hill_tox) + 1e-12)
        tox_pct = np.clip(tox_pct, 0.0, 99.9)

        max_risk = float(np.max(tox_pct))
        peak_idx = int(np.argmax(tox_pct))
        peak_time_h = float(t_arr[peak_idx])
        peak_conc = float(c_organ[peak_idx])

        status_level = "SAFE"
        if max_risk >= 65.0:
            status_level = "CRITICAL_TOXICITY"
        elif max_risk >= 35.0:
            status_level = "WARNING_ELEVATED"
        elif max_risk >= 18.0:
            status_level = "CAUTION_MONITOR"

        peak_organ_risks[organ_key] = round(max_risk, 1)
        organ_timeseries[organ_key] = {
            "organ_id": organ_key,
            "name": ocfg["name"],
            "korean_name": ocfg["korean_name"],
            "kp_partition": kp,
            "ec50_tox_mg_l": round(ec50_tox, 3),
            "peak_conc_mg_l": round(peak_conc, 3),
            "peak_risk_pct": round(max_risk, 1),
            "peak_time_h": round(peak_time_h, 2),
            "status": status_level,
            "primary_mechanism": ocfg["mechanism"],
            "lecture_pathway": ocfg["lecture_pathway"],
            "biomarkers": ocfg["biomarkers"],
            "concentration_series": [round(float(x), 3) for x in c_organ],
            "toxicity_risk_series": [round(float(x), 1) for x in tox_pct],
        }

    # Global PK summary metrics
    cmax_mg_l = float(np.max(c_central_arr))
    tmax_h = float(t_arr[int(np.argmax(c_central_arr))])
    auc_mg_h_l = float(np.trapezoid(c_central_arr, t_arr))
    min_gsh_pct = float(np.min(gsh_arr) * 100.0)

    # Highest risk organ
    highest_organ_id = max(peak_organ_risks, key=peak_organ_risks.get)
    highest_risk_pct = peak_organ_risks[highest_organ_id]

    return {
        "drug_id": drug["id"],
        "drug_name": drug["name"],
        "generic_class": drug["drug_class"],
        "route": regimen.route,
        "dose_mg": regimen.dose_mg,
        "num_doses": regimen.num_doses,
        "interval_h": regimen.interval_h,
        "patient_computed": {
            "crcl_ml_min": crcl,
            "bsa_m2": bsa,
            "vc_l": round(vc_base, 2),
            "vp_l": round(vp_base, 2),
            "cl_total_l_h": round(cl_eff, 2),
            "cl_renal_l_h": round(cl_renal, 2),
            "cl_hepatic_l_h": round(cl_hepatic, 2),
            "q_intercomp_l_h": round(q_base, 2),
            "k10_h": round(k10, 4),
            "k12_h": round(k12, 4),
            "k21_h": round(k21, 4),
            "ka_h": round(ka, 4),
            "f_bioavailability": round(f_bio, 3),
            "t_half_eff_h": t_half_alpha_beta,
        },
        "pk_summary": {
            "cmax_mg_l": round(cmax_mg_l, 3),
            "tmax_h": round(tmax_h, 2),
            "auc_0_t_mg_h_l": round(auc_mg_h_l, 2),
            "therapeutic_min_mg_l": drug["pd"]["therapeutic_window_mg_l"][0],
            "therapeutic_max_mg_l": drug["pd"]["therapeutic_window_mg_l"][1],
            "toxic_threshold_mg_l": drug["pd"]["toxic_plasma_threshold_mg_l"],
            "min_hepatic_gsh_pct": round(min_gsh_pct, 1),
            "primary_alert_organ": highest_organ_id,
            "max_organ_toxicity_pct": round(highest_risk_pct, 1),
            "overall_safety_status": (
                "CRITICAL_HAZARD" if highest_risk_pct >= 65.0
                else ("ELEVATED_RISK" if highest_risk_pct >= 35.0 else "THERAPEUTIC_SAFE")
            ),
        },
        "thermodynamics": thermo,
        "timeline": {
            "time_h": [round(float(t), 2) for t in t_arr],
            "gi_amount_mg": [round(float(x), 2) for x in a_gi_arr],
            "central_conc_mg_l": [round(float(x), 3) for x in c_central_arr],
            "peripheral_conc_mg_l": [round(float(x), 3) for x in c_periph_arr],
            "effect_conc_mg_l": [round(float(x), 3) for x in c_effect_arr],
            "metabolite_conc_mg_l": [round(float(x), 3) for x in c_met_arr],
            "hepatic_gsh_pct": [round(float(x * 100.0), 1) for x in gsh_arr],
            "efficacy_pct": [round(float(x), 1) for x in efficacy_arr],
        },
        "organs": organ_timeseries,
        "structure_3d": drug["structure_3d"],
    }
