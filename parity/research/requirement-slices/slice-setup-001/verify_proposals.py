#!/usr/bin/env python3
"""Recompute source hashes for slice-setup-001 proposals. Exit 0 only when all match."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REF = ROOT / "reference" / "cursor-plugins"
SLICE = Path(__file__).resolve().parent
INV = ROOT / "inventory.json"

SETUP_INVENTORY_PREFIXES = (
    "pstack/skills/setup-pstack/",
    "pstack/docs/guide/01-setup.md",
    "pstack/automations/benny/skills/setup-benny/",
    "pstack/skills/create-verification-skill/",
    "pstack/skills/maintain-verification-skill/",
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
    data = json.loads(proposals_path.read_text())
    proposals = data["proposals"]
    failures: list[str] = []

    if len(proposals) < 12:
        failures.append(f"proposal count {len(proposals)} < 12")

    covered_files: set[str] = set()
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
            "locator",
            "trigger",
            "expectedObservation",
            "configurationIds",
            "evidenceMapping",
        ):
            if key not in p and key not in src:
                if key in ("locator",) and key in src:
                    continue
                if key == "locator":
                    continue
                if key not in p:
                    failures.append(f"{p['id']}: missing {key}")
        if "locator" not in src:
            failures.append(f"{p['id']}: missing source.locator")
        covered_files.add(src["file"])
        em = p.get("evidenceMapping") or {}
        if em.get("kind") not in ("paired-evidence", "unverified"):
            failures.append(f"{p['id']}: evidenceMapping.kind must be paired-evidence or unverified")

    inv = json.loads(INV.read_text())
    items = inv.get("items", []) if isinstance(inv, dict) else inv
    setup_items = sorted(
        {
            n["path"]
            for n in items
            if isinstance(n, dict)
            and isinstance(n.get("path"), str)
            and any(
                n["path"].startswith(pref) or n["path"] == pref.rstrip("/")
                for pref in SETUP_INVENTORY_PREFIXES
            )
        }
    )

    uncovered = sorted(set(setup_items) - covered_files)
    out = {
        "proposalCount": len(proposals),
        "hashOk": len(failures) == 0,
        "failures": failures,
        "coveredSourceFiles": sorted(covered_files),
        "setupInventoryItems": sorted(set(setup_items)),
        "uncoveredSetupInventory": uncovered,
    }
    (SLICE / "verify-output.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
