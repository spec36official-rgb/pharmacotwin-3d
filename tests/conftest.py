"""Shared fixtures: keep every test offline and deterministic."""

import pytest

from backend import argon_agent


@pytest.fixture(autouse=True)
def offline_backend(monkeypatch):
    """No Gemini key, no AlphaFold DB / UniProt network calls."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(argon_agent, "fetch_live_alphafold_ebi_metadata", lambda uniprot_id: None)
    monkeypatch.setattr(argon_agent, "_fetch_uniprot_fasta", lambda uniprot_id: None)
    argon_agent._uniprot_sequence_cache.clear()
