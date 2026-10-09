#!/usr/bin/env python3
"""Recompute source hashes for slice-setup-002 proposals and check leftover coverage."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REF = ROOT / "reference" / "cursor-plugins"
SLICE = Path(__file__).resolve().parent
INV = ROOT / "inventory.json"

LEFTOVER_PATHS = (
    "pstack/automations/benny/skills/setup-benny/SKILL.md",
    "pstack/skills/create-verification-skill/SKILL.md",
    "pstack/skills/create-verification-skill/references/feature-map-example/README.md",
    "pstack/skills/create-verification-skill/references/feature-map-example/create-note.md",
    "pstack/skills/create-verification-skill/references/feature-map-example/search.md",
    "pstack/skills/maintain-verification-skill/SKILL.md",
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def span_hash(text: str, start: int, end: int) -> str:
    lines = text.splitlines(keepends=True)
    if start < 1 or end < start or end > len(lines):
        raise ValueError(f"bad span {start}-{end} for {len(lines)} lines")
    return sha256_bytes("".join(lines[start - 1 : end]).encode("utf-8"))


def resolve_source(rel: str) -> Path:
    return REF / rel


def main() -> int:
    proposals_path = SLICE / "proposals.json"
    dispositions_path = SLICE / "dispositions.json"
    data = json.loads(proposals_path.read_text())
    disp_data = json.loads(dispositions_path.read_text())
    proposals = data["proposals"]
    dispositions = disp_data["dispositions"]
    failures: list[str] = []

    if len(proposals) < 15:
        failures.append(f"proposal count {len(proposals)} < 15")

    covered_by_proposal: set[str] = set()
    for p in proposals:
        if p.get("status") == "verified":
            failures.append(f"{p['id']}: status must not be verified")
        src = p["source"]
        path = resolve_source(src["file"])
        if not path.is_file():
            failures.append(f"{p['id']}: missing source {path}")
            continue
        body = path.read_text()
        file_digest = sha256_bytes(path.read_bytes())
        if file_digest != src["fileSha256"]:
            failures.append(
                f"{p['id']}: fileSha256 mismatch got {file_digest} expected {src['fileSha256']}"
            )
        try:
            got_span = span_hash(body, src["lineStart"], src["lineEnd"])
        except ValueError as exc:
            failures.append(f"{p['id']}: {exc}")
            continue
        if got_span != src["spanSha256"]:
            failures.append(
                f"{p['id']}: spanSha256 mismatch got {got_span} expected {src['spanSha256']}"
            )
        for key in (
            "trigger",
            "expectedObservation",
            "configurationIds",
            "evidenceMapping",
        ):
            if key not in p:
                failures.append(f"{p['id']}: missing {key}")
        if "locator" not in src:
            failures.append(f"{p['id']}: missing source.locator")
        covered_by_proposal.add(src["file"])
        em = p.get("evidenceMapping") or {}
        if em.get("kind") not in ("paired-evidence", "unverified"):
            failures.append(
                f"{p['id']}: evidenceMapping.kind must be paired-evidence or unverified"
            )

    covered_by_disposition: set[str] = set()
    for d in dispositions:
        rel = d.get("path")
        if not isinstance(rel, str):
            failures.append("disposition missing path")
            continue
        if d.get("disposition") != "non-requirement-example-asset":
            failures.append(f"{rel}: unexpected disposition {d.get('disposition')}")
        if not d.get("reason"):
            failures.append(f"{rel}: disposition missing reason")
        path = resolve_source(rel)
        if not path.is_file():
            failures.append(f"disposition {rel}: missing file")
            continue
        file_digest = sha256_bytes(path.read_bytes())
        if file_digest != d.get("fileSha256"):
            failures.append(
                f"disposition {rel}: fileSha256 mismatch got {file_digest} expected {d.get('fileSha256')}"
            )
        covered_by_disposition.add(rel)

    leftover_set = set(LEFTOVER_PATHS)
    covered = covered_by_proposal | covered_by_disposition
    uncovered = sorted(leftover_set - covered)
    if uncovered:
        failures.append(f"uncovered leftovers: {uncovered}")

    inv = json.loads(INV.read_text())
    items = inv.get("items", []) if isinstance(inv, dict) else inv
    inv_paths = {
        n["path"]
        for n in items
        if isinstance(n, dict) and isinstance(n.get("path"), str)
    }
    missing_from_inventory = sorted(leftover_set - inv_paths)
    if missing_from_inventory:
        failures.append(f"leftovers missing from inventory: {missing_from_inventory}")

    out = {
        "proposalCount": len(proposals),
        "dispositionCount": len(dispositions),
        "hashOk": len(failures) == 0,
        "failures": failures,
        "coveredByProposal": sorted(covered_by_proposal),
        "coveredByDisposition": sorted(covered_by_disposition),
        "leftoverPaths": sorted(leftover_set),
        "uncoveredLeftovers": uncovered,
    }
    (SLICE / "verify-output.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
