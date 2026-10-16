"""
Download real AlphaFold DB 3D protein structure PDB files (and extract C-alpha backbone + pLDDT JSON
for instant Three.js 3D rendering inside the organ space-flight view) from Google DeepMind x EMBL-EBI AlphaFold DB.
"""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDB_DIR = ROOT / "static" / "assets" / "alphafold_pdb"
PDB_DIR.mkdir(parents=True, exist_ok=True)

# 8 Organ Toxicology Targets -> Human UniProt Accessions
ORGAN_TARGETS = {
    "liver": {
        "uniprot": "P05181",
        "gene": "CYP2E1",
        "name": "Cytochrome P450 2E1 (Hepatic APAP -> NAPQI Bioactivation)",
    },
    "heart": {
        "uniprot": "Q12809",
        "gene": "KCNH2",
        "name": "hERG Potassium Channel Kv11.1 (Cardiac QT Prolongation)",
    },
    "blood": {
        "uniprot": "P11413",
        "gene": "G6PD",
        "name": "Glucose-6-Phosphate Dehydrogenase (RBC Oxidative Shield)",
    },
    "brain": {
        "uniprot": "P14416",
        "gene": "DRD2",
        "name": "Dopamine D2 Receptor (CNS Extrapyramidal Pathway)",
    },
    "lungs": {
        "uniprot": "P12821",
        "gene": "ACE",
        "name": "Pulmonary Angiotensin-Converting Enzyme / Alveolar Target",
    },
    "ocular": {
        "uniprot": "P08100",
        "gene": "RHO",
        "name": "Retinal Rhodopsin G-Protein Coupled Receptor",
    },
    "gi": {
        "uniprot": "P08183",
        "gene": "ABCB1",
        "name": "Intestinal P-glycoprotein (MDR1) Efflux Transporter",
    },
    "kidney": {
        "uniprot": "O15244",
        "gene": "SLC22A2",
        "name": "Renal Organic Cation Transporter 2 (OCT2 / Proximal Tubule S2-S3)",
    },
}


def parse_ca_backbone_from_pdb(pdb_text: str, max_points: int = 450):
    """
    Extract C-alpha (CA) 3D coordinates (x, y, z) and AlphaFold pLDDT score (stored in B-factor column)
    from a real AlphaFold PDB file, centered and normalized to fit a 1.0-unit 3D hologram bounding sphere.
    """
    ca_atoms = []
    for line in pdb_text.splitlines():
        if line.startswith("ATOM  ") and line[12:16].strip() == "CA":
            try:
                x = float(line[30:38])
                y = float(line[38:46])
                z = float(line[46:54])
                plddt = float(line[60:66])
                res_name = line[17:20].strip()
                res_seq = int(line[22:26].strip())
                ca_atoms.append((x, y, z, plddt, res_name, res_seq))
            except ValueError:
                continue

    if not ca_atoms:
        return {"points": [], "mean_plddt": 0.0, "residue_count": 0}

    total_res = len(ca_atoms)
    mean_plddt = round(sum(a[3] for a in ca_atoms) / total_res, 2)

    # Subsample evenly if protein is very large (e.g., >450 residues) so Three.js TubeGeometry is silky smooth
    step = max(1, total_res // max_points)
    sampled = ca_atoms[::step]

    # Center at (0,0,0) and normalize radius to ~0.48 units
    cx = sum(a[0] for a in sampled) / len(sampled)
    cy = sum(a[1] for a in sampled) / len(sampled)
    cz = sum(a[2] for a in sampled) / len(sampled)

    max_dist = max(
        max(((a[0] - cx) ** 2 + (a[1] - cy) ** 2 + (a[2] - cz) ** 2) ** 0.5 for a in sampled),
        1e-3,
    )
    scale = 0.48 / max_dist

    points = [
        [
            round((a[0] - cx) * scale, 4),
            round((a[1] - cy) * scale, 4),
            round((a[2] - cz) * scale, 4),
            round(a[3], 1),  # pLDDT (0-100)
        ]
        for a in sampled
    ]
    return {
        "points": points,
        "mean_plddt": mean_plddt,
        "residue_count": total_res,
    }


def main():
    manifest = {}
    for organ, info in ORGAN_TARGETS.items():
        uniprot = info["uniprot"]
        api_url = f"https://alphafold.ebi.ac.uk/api/prediction/{uniprot}"
        print(f"[{organ.upper()}] Querying AlphaFold DB API: {api_url} ...")
        try:
            req = urllib.request.Request(api_url, headers={"User-Agent": "PharmacoTwin3D/2.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            entry = data[0] if isinstance(data, list) and data else data
            pdb_url = entry.get("pdbUrl")
            entry_id = entry.get("entryId", f"AF-{uniprot}-F1")
            if not pdb_url:
                pdb_url = f"https://alphafold.ebi.ac.uk/files/{entry_id}-model_v4.pdb"

            print(f"  -> Downloading real AlphaFold PDB: {pdb_url}")
            pdb_req = urllib.request.Request(pdb_url, headers={"User-Agent": "PharmacoTwin3D/2.0"})
            with urllib.request.urlopen(pdb_req, timeout=25) as pdb_resp:
                pdb_text = pdb_resp.read().decode("utf-8")

            local_pdb_path = PDB_DIR / f"{organ}_{uniprot}.pdb"
            local_pdb_path.write_text(pdb_text, encoding="utf-8")

            backbone = parse_ca_backbone_from_pdb(pdb_text)
            manifest[organ] = {
                "organ": organ,
                "uniprot": uniprot,
                "entry_id": entry_id,
                "gene": info["gene"],
                "name": info["name"],
                "pdb_url": f"/static/assets/alphafold_pdb/{organ}_{uniprot}.pdb",
                "external_pdb_url": pdb_url,
                "residue_count": backbone["residue_count"],
                "mean_plddt": backbone["mean_plddt"],
                "backbone_ca": backbone["points"],
            }
            print(
                f"  [OK] Saved {local_pdb_path.name} ({backbone['residue_count']} residues, "
                f"mean pLDDT={backbone['mean_plddt']}, {len(backbone['points'])} 3D C-alpha nodes)"
            )
        except Exception as e:
            print(f"  [ERROR] {organ} ({uniprot}): {e}")

    manifest_path = PDB_DIR / "alphafold_structures.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nSaved AlphaFold 3D backbone & PDB manifest to {manifest_path}")


if __name__ == "__main__":
    main()
