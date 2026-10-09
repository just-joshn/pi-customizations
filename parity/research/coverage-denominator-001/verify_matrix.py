#!/usr/bin/env python3
"""Verify disposition matrix against inventory and requirements ledgers."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
INV_PATH = ROOT / "inventory.json"
REQ_PATH = ROOT / "requirements.json"
MATRIX_PATH = OUT / "disposition-matrix.json"

ALLOWED = {"mapped", "deferred", "out-of-scope"}


def main() -> int:
    inv = json.loads(INV_PATH.read_text())
    req = json.loads(REQ_PATH.read_text())
    matrix = json.loads(MATRIX_PATH.read_text())

    inv_items = inv["items"]
    req_by_file: dict[str, set[str]] = {}
    for r in req["requirements"]:
        req_by_file.setdefault(r["source"]["file"], set()).add(r["id"])

    errors: list[str] = []

    if matrix["matrixItemCount"] != len(inv_items):
        errors.append(
            f"matrixItemCount {matrix['matrixItemCount']} != inventory {len(inv_items)}"
        )
    if len(matrix["items"]) != len(inv_items):
        errors.append(f"len(items) {len(matrix['items'])} != inventory {len(inv_items)}")

    inv_by_path = {i["path"]: i for i in inv_items}
    matrix_paths = [row["path"] for row in matrix["items"]]
    if len(matrix_paths) != len(set(matrix_paths)):
        errors.append("duplicate paths in matrix")
    if set(matrix_paths) != set(inv_by_path):
        missing = sorted(set(inv_by_path) - set(matrix_paths))
        extra = sorted(set(matrix_paths) - set(inv_by_path))
        if missing:
            errors.append(f"missing inventory paths: {missing[:5]}...")
        if extra:
            errors.append(f"extra matrix paths: {extra[:5]}...")

    counts = {"mapped": 0, "deferred": 0, "out-of-scope": 0}
    for row in matrix["items"]:
        path = row["path"]
        d = row["disposition"]
        status = d["status"]
        if status not in ALLOWED:
            errors.append(f"{path}: illegal status {status!r}")
            continue
        counts[status] += 1
        if row["sha256"] != inv_by_path[path]["sha256"]:
            errors.append(f"{path}: sha256 mismatch vs inventory")
        if not d.get("citation"):
            errors.append(f"{path}: missing citation")
        if not d.get("reason"):
            errors.append(f"{path}: missing reason")
        if status == "mapped":
            if not d["requirementIds"]:
                errors.append(f"{path}: mapped without requirementIds")
            expected = req_by_file.get(path, set())
            actual = set(d["requirementIds"])
            if actual != expected:
                errors.append(
                    f"{path}: requirementIds {sorted(actual)} != ledger {sorted(expected)}"
                )
            # No invented IDs
            unknown = actual - {r["id"] for r in req["requirements"]}
            if unknown:
                errors.append(f"{path}: unknown requirement ids {sorted(unknown)}")
        else:
            if d["requirementIds"]:
                errors.append(f"{path}: {status} must have empty requirementIds")

    if counts != matrix.get("counts"):
        errors.append(f"counts field {matrix.get('counts')} != recomputed {counts}")

    unresolved = matrix.get("unresolved") or []
    recommended = matrix.get("coverageDenominatorCompleteRecommended")
    if unresolved and recommended:
        errors.append("complete recommended true while unresolved non-empty")
    if not unresolved and len(matrix["items"]) == len(inv_items) and not recommended:
        errors.append("complete recommended false despite full explicit dispositions")

    # File hash of matrix on disk
    matrix_bytes = MATRIX_PATH.read_bytes()
    digest = hashlib.sha256(matrix_bytes).hexdigest()

    result = {
        "ok": not errors,
        "inventoryItemCount": len(inv_items),
        "matrixItemCount": len(matrix["items"]),
        "counts": counts,
        "unresolvedCount": len(unresolved),
        "coverageDenominatorCompleteRecommended": recommended,
        "matrixSha256": digest,
        "errors": errors,
    }
    (OUT / "verify-output.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
