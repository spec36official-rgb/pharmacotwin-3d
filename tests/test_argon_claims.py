"""Argon claim verification loop, honest labelling, SMILES token counts and AF3 job sequence."""

import json

import pytest

from backend import argon_agent
from backend.argon_agent import (
    _check_argon_claims,
    _expected_claims,
    analyze_simulation_with_argon,
    approximate_novel_drug_af3,
    parse_pdb_ca_sequence,
    smiles_atom_counts,
)
from backend.drug_db import DRUG_DATABASE
from backend.pkpd_engine import DosingRegimen, PatientProfile, simulate_pkpd_and_organs

OLD_MYOGLOBIN = "MVLSEGEWQLVLHVWAKVEADVAGHGQDILIRLFKSHPETLEKFDRFKHLKTEAEMKASEDLKKHGVTVLTALGAILKKKGHHEAELKPLAQSHATKHKIPIKYLEFISEAIIHVLHSRHPGDFGADAQGAMNKALELFRKDIAAKYKELGYQG"


def _simulate(drug_id="acetaminophen", dose_mg=1000.0):
    patient = PatientProfile()
    regimen = DosingRegimen(drug_id=drug_id, route="oral", dose_mg=dose_mg)
    return simulate_pkpd_and_organs(DRUG_DATABASE[drug_id], patient, regimen), patient, regimen


def _summary(claims):
    return (
        f"Cmax reaches {claims['cmax_mg_l']} mg/L at {claims['tmax_h']} h. "
        f"Peak risk is {claims['primary_peak_risk_pct']}% in the {claims['primary_alert_organ']} "
        f"with CrCl {claims['crcl_ml_min']} mL/min."
    )


def _argon_reply(claims, summary):
    return json.dumps({
        "executive_summary": summary,
        "executive_summary_ko": "요약",
        "molecular_cascade_4step": {"step1_delivery": "a", "step2_reaction": "b", "step3_cellular_dysfunction": "c", "step4_disrepair_biomarkers": "d"},
        "antidote_protocol": "N-acetylcysteine per protocol.",
        "claims": claims,
    })


def test_claim_checker_accepts_correct_and_flags_wrong_cmax_and_organ():
    sim, _, _ = _simulate()
    truth = _expected_claims(sim)
    issues, matched, mentions = _check_argon_claims(sim, truth, _summary(truth))
    assert issues == [] and matched == 6 and mentions == 4

    wrong = dict(truth, cmax_mg_l=truth["cmax_mg_l"] * 1.5, primary_alert_organ="kidney" if truth["primary_alert_organ"] != "kidney" else "liver")
    issues, _, _ = _check_argon_claims(sim, wrong, _summary(truth))
    assert {i["field"] for i in issues} == {"cmax_mg_l", "primary_alert_organ"}

    # A wrong number in the prose is caught even when the structured claims are right.
    issues, _, _ = _check_argon_claims(sim, truth, _summary(dict(truth, cmax_mg_l=round(truth["cmax_mg_l"] * 2, 2))))
    assert [i["field"] for i in issues] == ["executive_summary"]


def test_claim_checker_ignores_numbers_without_checked_units():
    sim, _, _ = _simulate()
    truth = _expected_claims(sim)
    prose = "Give 1000 mg q8h; k10 0.82 h⁻¹, dose 15 mg/kg, AUC 999 mg·h/L, SCr 0.95 mg/dL."
    issues, _, mentions = _check_argon_claims(sim, truth, prose)
    assert issues == [] and mentions == 0


class _FakeInteraction:
    def __init__(self, text):
        self.output_text = text


def _install_fake_client(monkeypatch, replies, calls):
    from google import genai

    class FakeInteractions:
        def create(self, **kwargs):
            assert not {"temperature", "top_p", "top_k", "thinking_budget"} & set(kwargs)
            assert not {"temperature", "top_p", "top_k", "thinking_budget"} & set(kwargs.get("generation_config", {}))
            calls.append(kwargs)
            return _FakeInteraction(replies[len(calls) - 1])

    class FakeClient:
        def __init__(self, api_key=None, http_options=None):
            assert http_options is not None and http_options.timeout
            self.interactions = FakeInteractions()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(genai, "Client", FakeClient)


def test_argon_retry_loop_corrects_wrong_first_answer(monkeypatch):
    sim, patient, regimen = _simulate()
    truth = _expected_claims(sim)
    wrong = dict(truth, cmax_mg_l=round(truth["cmax_mg_l"] * 3, 2))
    calls = []
    _install_fake_client(monkeypatch, [_argon_reply(wrong, _summary(wrong)), _argon_reply(truth, _summary(truth))], calls)

    analysis = analyze_simulation_with_argon(sim, patient, regimen)

    loop = analysis["verification_loop"]
    assert loop["iterations"] == 2 and loop["all_passed"] is True
    assert [a["passed"] for a in loop["attempts"]] == [False, True]
    assert "ARGON_CLAIM_CONSISTENCY" in loop["attempts"][0]["failed_check_ids"]
    assert analysis["argon_called"] is True
    assert analysis["model_used"] == "gemini-4-argon (Interactions API)"
    assert analysis["executive_summary"] == _summary(truth)
    # The retry prompt names the wrong claim and the correct value.
    assert "cmax_mg_l" in calls[1]["input"] and str(truth["cmax_mg_l"]) in calls[1]["input"]


def test_argon_always_wrong_falls_back_to_verified_template(monkeypatch):
    sim, patient, regimen = _simulate()
    truth = _expected_claims(sim)
    wrong = dict(truth, primary_alert_organ="brain" if truth["primary_alert_organ"] != "brain" else "heart")
    calls = []
    _install_fake_client(monkeypatch, [_argon_reply(wrong, _summary(truth))] * 3, calls)

    analysis = analyze_simulation_with_argon(sim, patient, regimen)

    loop = analysis["verification_loop"]
    assert len(calls) == 3
    assert [a["source"] for a in loop["attempts"]] == ["argon", "argon", "argon", "template"]
    assert loop["iterations"] == 4 and loop["all_passed"] is True
    assert analysis["narrative_source"] == "deterministic_template"
    assert analysis["model_used"].startswith("Deterministic template (Argon output failed claim verification")


def test_argon_call_error_is_labelled(monkeypatch):
    from google import genai

    class BrokenClient:
        def __init__(self, **kwargs):
            self.interactions = self

        def create(self, **kwargs):
            raise TimeoutError("slow")

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(genai, "Client", BrokenClient)
    sim, patient, regimen = _simulate()
    analysis = analyze_simulation_with_argon(sim, patient, regimen)
    assert analysis["argon_called"] is False
    assert analysis["model_used"] == "Deterministic template (Argon call failed: TimeoutError)"
    assert analysis["verification_loop"]["all_passed"] is True


def test_no_api_key_uses_honestly_labelled_template():
    sim, patient, regimen = _simulate("gentamicin", 400.0)
    analysis = analyze_simulation_with_argon(sim, patient, regimen)
    loop = analysis["verification_loop"]
    assert analysis["argon_called"] is False
    assert analysis["model_used"] == "Deterministic template (Argon not called: no API key)"
    assert loop["iterations"] == 1 and loop["all_passed"] is True and loop["total_checks"] == 6
    assert loop["attempts"] == [{"iteration": 1, "source": "template", "passed": True, "failed_check_ids": []}]


@pytest.mark.parametrize(
    "smiles, heavy, n, o, halogens",
    [
        ("ClC(Cl)Cl", 4, 0, 0, 3),
        ("c1ccccc1O", 7, 0, 1, 0),
        ("[Pt](N)(N)(Cl)Cl", 5, 2, 0, 2),
        ("N.N.Cl[Pt]Cl", 5, 2, 0, 2),
        ("c1cc[nH]c1", 5, 1, 0, 0),
        ("BrCCBr", 4, 0, 0, 2),
    ],
)
def test_smiles_token_counts(smiles, heavy, n, o, halogens):
    assert smiles_atom_counts(smiles) == {"heavy_atoms": heavy, "n_count": n, "o_count": o, "halogens": halogens}


def test_af3_job_uses_target_sequence_from_local_alphafold_pdb():
    # Lipophilic basic amine -> heuristic hERG (Q12809) target with a bundled AlphaFold DB model.
    bundle = approximate_novel_drug_af3(
        "NovelAmine", "CCCCCCCCCCCCCCCCCN", PatientProfile(), DosingRegimen(drug_id="novel", route="oral", dose_mg=100.0)
    )
    job, meta = bundle["af3_job_spec"], bundle["af3_job_metadata"]
    assert meta["uniprot"] == "Q12809" and meta["sequence_source"] == "alphafold_db_local_pdb"
    pdb_text = (argon_agent.ALPHAFOLD_PDB_DIR / "heart_Q12809.pdb").read_text(encoding="utf-8")
    sequence = job["sequences"][0]["protein"]["sequence"]
    assert sequence == parse_pdb_ca_sequence(pdb_text)
    assert sequence != OLD_MYOGLOBIN and len(sequence) == 1159
    assert job["sequences"][1] == {"ligand": {"id": "L", "smiles": "CCCCCCCCCCCCCCCCCN"}}
    assert set(job) == {"name", "modelSeeds", "sequences", "dialect", "version"}


def test_af3_job_without_local_pdb_or_network_is_marked_unavailable():
    # Paraquat template targets P16435, which has no bundled PDB; UniProt fetch is blocked in tests.
    bundle = approximate_novel_drug_af3(
        "Paraquat", "", PatientProfile(), DosingRegimen(drug_id="novel", route="oral", dose_mg=100.0)
    )
    assert bundle["af3_job_metadata"]["sequence_source"] == "unavailable"
    assert bundle["af3_job_spec"]["sequences"][0]["protein"]["sequence"] is None
    assert bundle["argon_analysis"]["verification_loop"]["all_passed"] is True


def test_af3_job_uses_uniprot_when_no_local_pdb(monkeypatch):
    monkeypatch.setattr(argon_agent, "_fetch_uniprot_fasta", lambda uniprot_id: "MKTAYIAKQR")
    bundle = approximate_novel_drug_af3(
        "Isoniazid", "", PatientProfile(), DosingRegimen(drug_id="novel", route="oral", dose_mg=300.0)
    )
    assert bundle["af3_job_metadata"]["sequence_source"] == "uniprot_rest"
    assert bundle["af3_job_spec"]["sequences"][0]["protein"]["sequence"] == "MKTAYIAKQR"
