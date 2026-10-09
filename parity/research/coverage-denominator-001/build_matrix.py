#!/usr/bin/env python3
"""Build inventory disposition matrix for u-coverage-denominator-001.

Rerun: python3 parity/research/coverage-denominator-001/build_matrix.py
Verify: python3 parity/research/coverage-denominator-001/verify_matrix.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parent
OUT = Path(__file__).resolve().parent
INV_PATH = ROOT / "inventory.json"
REQ_PATH = ROOT / "requirements.json"
SLICE_SETUP_002_DISP = (
    ROOT / "research/requirement-slices/slice-setup-002/dispositions.json"
)
REVISION = "ccb5507cec1546dc88135c1139c811e6c59115ba"

# Exact paths previously disposed as non-requirement example assets.
PRIOR_EXAMPLE_OOS = {
    "pstack/skills/create-verification-skill/references/feature-map-example/README.md",
    "pstack/skills/create-verification-skill/references/feature-map-example/create-note.md",
    "pstack/skills/create-verification-skill/references/feature-map-example/search.md",
}

# Package-role / non-behavioral paths. Item stays in the denominator.
PACKAGE_ROLE_OOS = {
    "cursor-team-kit/LICENSE": (
        "package-role-license",
        "License text for plugin distribution. Contract section 4 package-role disposition. "
        "Not an independently falsifiable user-journey behavior.",
        "parity/contract.md#4-model-the-behavior-before-implementing-it",
    ),
    "pstack/LICENSE": (
        "package-role-license",
        "License text for plugin distribution. Contract section 4 package-role disposition. "
        "Not an independently falsifiable user-journey behavior.",
        "parity/contract.md#4-model-the-behavior-before-implementing-it",
    ),
    "cursor-team-kit/assets/avatar.png": (
        "package-role-asset",
        "Marketplace avatar image. Packaging asset only.",
        "parity/contract.md#4-model-the-behavior-before-implementing-it",
    ),
    "pstack/assets/logo.png": (
        "package-role-asset",
        "Plugin logo image. Packaging asset only.",
        "parity/contract.md#4-model-the-behavior-before-implementing-it",
    ),
    "pstack/.gitignore": (
        "package-role-vcs-ignore",
        "Repository ignore rules for the plugin tree. No product user journey.",
        "parity/contract.md#4-model-the-behavior-before-implementing-it",
    ),
    "pstack/skills/poteto-mode/scripts/bun.lock": (
        "package-role-lockfile",
        "Bun lockfile for poteto-mode scripts subtree. Dependency pin artifact, not a journey.",
        "parity/contract.md#4-model-the-behavior-before-implementing-it",
    ),
    "pstack/skills/poteto-mode/scripts/package.json": (
        "package-role-manifest",
        "npm/bun package manifest for poteto-mode scripts. Packaging metadata.",
        "parity/contract.md#4-model-the-behavior-before-implementing-it",
    ),
    "pstack/skills/poteto-mode/scripts/watch-pr/tsconfig.json": (
        "package-role-tsconfig",
        "TypeScript project config for watch-pr. Build config, not a user journey.",
        "parity/contract.md#4-model-the-behavior-before-implementing-it",
    ),
    "pstack/automations/benny/skills/reproduce-and-fix-issues/references/feature-map.example.md": (
        "non-requirement-example-asset",
        "Example feature-map template shipped with Benny. Illustrative shape only; "
        "behavioral contract lives on setup-benny / create-verification-skill requirements.",
        "parity/research/requirement-slices/slice-setup-002/dispositions.json",
    ),
    "pstack/automations/benny/skills/triage-issue-reports/references/routing.example.md": (
        "non-requirement-example-asset",
        "Example routing table for triage. Illustrative only.",
        "parity/research/requirement-slices/slice-setup-002/dispositions.json",
    ),
    "pstack/automations/benny/templates/configuration.example.yaml": (
        "non-requirement-example-asset",
        "Example Benny configuration YAML with placeholders. Not a live behavior contract.",
        "parity/research/requirement-slices/slice-setup-002/dispositions.json",
    ),
}

GUIDE_IMAGE_PREFIX = "pstack/docs/guide/images/"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text())


def classify(path: str, req_ids: list[str]) -> dict:
    if req_ids:
        return {
            "status": "mapped",
            "requirementIds": sorted(req_ids),
            "reason": (
                f"Exact source.file match in parity/requirements.json for "
                f"{len(req_ids)} requirement(s)."
            ),
            "citation": "parity/requirements.json",
            "packageRole": None,
        }

    if path in PRIOR_EXAMPLE_OOS:
        return {
            "status": "out-of-scope",
            "requirementIds": [],
            "reason": (
                "Prior slice-setup-002 disposition non-requirement-example-asset. "
                "Illustrative Notes app feature-map example; product shape contract is on "
                "PSTACK-SETUP-CREATE-VERIFY-FEATURE-MAP-001 against create-verification-skill/SKILL.md."
            ),
            "citation": str(SLICE_SETUP_002_DISP.relative_to(REPO)),
            "packageRole": "non-requirement-example-asset",
        }

    if path in PACKAGE_ROLE_OOS:
        role, reason, citation = PACKAGE_ROLE_OOS[path]
        return {
            "status": "out-of-scope",
            "requirementIds": [],
            "reason": reason,
            "citation": citation,
            "packageRole": role,
        }

    if path.startswith(GUIDE_IMAGE_PREFIX) and path.endswith((".jpg", ".png", ".jpeg", ".webp")):
        return {
            "status": "out-of-scope",
            "requirementIds": [],
            "reason": "Guide illustration image. Docs packaging asset; no falsifiable journey.",
            "citation": "parity/contract.md#4-model-the-behavior-before-implementing-it",
            "packageRole": "package-role-asset",
        }

    # Deferred: keep active for later requirement extraction (standing order: no scope reduction).
    if path.startswith("cursor-team-kit/"):
        topic = "cursor-team-kit inventory without ledger source.file match"
    elif path.startswith("pstack/skills/poteto-mode/playbooks/"):
        topic = "poteto-mode playbook file; only playbook-todo matching is ledgered on SKILL.md"
    elif path.startswith("pstack/skills/poteto-mode/scripts/"):
        topic = "poteto-mode scripts tooling; executable behaviors not yet atomic requirements"
    elif path.startswith("pstack/skills/poteto-mode/references/"):
        topic = "poteto-mode reference; supporting procedure not yet atomic requirements"
    elif "/references/" in path:
        topic = "skill/agent reference supporting file; parent SKILL.md may be mapped but this path is not a ledger source.file"
    elif path.startswith("pstack/docs/guide/"):
        topic = "guide chapter without ledger source.file match (01-setup.md is mapped)"
    elif path.startswith("pstack/automations/benny/"):
        topic = "Benny pack supporting doc/template/reference without ledger source.file match"
    elif path.endswith("/SKILL.md") or path.endswith(".mdc") or "/agents/" in path:
        topic = "discoverable skill/agent/rule entry point without ledger source.file match"
    else:
        topic = "inventory path without ledger source.file match"

    return {
        "status": "deferred",
        "requirementIds": [],
        "reason": (
            f"Deferred requirement extraction: {topic}. "
            "Item remains in the coverage denominator. Standing order forbids scope reduction."
        ),
        "citation": "parity/requirements.json#openWork;parity/contract.md#4-model-the-behavior-before-implementing-it",
        "packageRole": None,
    }


def inventory_patch_status(status: str) -> str:
    """Status values for coordinator inventory merge (must not be unassigned)."""
    return status


def main() -> None:
    inv = load_json(INV_PATH)
    req = load_json(REQ_PATH)
    items = inv["items"]
    requirements = req["requirements"]

    by_file: dict[str, list[str]] = {}
    for r in requirements:
        by_file.setdefault(r["source"]["file"], []).append(r["id"])

    # Confirm prior example dispositions still match inventory digests.
    prior = load_json(SLICE_SETUP_002_DISP)
    prior_by_path = {d["path"]: d for d in prior["dispositions"]}

    matrix_rows = []
    unresolved = []
    counts = {"mapped": 0, "deferred": 0, "out-of-scope": 0}

    for item in items:
        path = item["path"]
        req_ids = by_file.get(path, [])
        decision = classify(path, req_ids)

        if path in prior_by_path:
            prior_sha = prior_by_path[path]["fileSha256"]
            if prior_sha != item["sha256"]:
                unresolved.append(
                    {
                        "path": path,
                        "issue": "prior-slice-disposition-hash-mismatch",
                        "inventorySha256": item["sha256"],
                        "priorSha256": prior_sha,
                    }
                )

        if decision["status"] not in ("mapped", "deferred", "out-of-scope"):
            unresolved.append({"path": path, "issue": "invalid-status", "status": decision["status"]})
        if decision["status"] == "mapped" and not decision["requirementIds"]:
            unresolved.append({"path": path, "issue": "mapped-without-requirement-ids"})
        if decision["status"] in ("deferred", "out-of-scope") and not decision["reason"]:
            unresolved.append({"path": path, "issue": "missing-reason"})
        if not decision.get("citation"):
            unresolved.append({"path": path, "issue": "missing-citation"})

        counts[decision["status"]] = counts.get(decision["status"], 0) + 1

        matrix_rows.append(
            {
                "path": path,
                "sha256": item["sha256"],
                "disposition": {
                    "status": inventory_patch_status(decision["status"]),
                    "requirementIds": decision["requirementIds"],
                    "reason": decision["reason"],
                    "citation": decision["citation"],
                    "packageRole": decision["packageRole"],
                },
                "behavioralCoverageVerified": False,
            }
        )

    matrix_rows.sort(key=lambda r: r["path"])

    matrix = {
        "schemaVersion": 1,
        "sliceId": "coverage-denominator-001",
        "brief": "parity/briefs/u-coverage-denominator-001.md",
        "sourceRevision": inv.get("sourceRevision") or REVISION,
        "inventoryItemCount": len(items),
        "matrixItemCount": len(matrix_rows),
        "requirementCount": len(requirements),
        "coverageDenominatorCompleteRecommended": len(unresolved) == 0
        and len(matrix_rows) == len(items),
        "counts": counts,
        "unresolved": unresolved,
        "rules": {
            "mapped": "Inventory path equals a requirements[].source.file; requirementIds taken from that ledger.",
            "deferred": "No invented mappings. Behavioral or supporting source without a ledger source.file stays deferred with reason.",
            "out-of-scope": "Package-role license/asset/lock/config or prior non-requirement example asset; reason and citation required.",
            "denominator": "No inventory paths removed. deferred and out-of-scope remain counted.",
        },
        "items": matrix_rows,
    }

    matrix_path = OUT / "disposition-matrix.json"
    matrix_bytes = (json.dumps(matrix, indent=2, sort_keys=False) + "\n").encode()
    matrix_path.write_bytes(matrix_bytes)
    matrix_hash = sha256_bytes(matrix_bytes)

    # Stable hash over path+status+sorted req ids+reason for merge pin.
    pin_lines = []
    for row in matrix_rows:
        d = row["disposition"]
        pin_lines.append(
            "|".join(
                [
                    row["path"],
                    row["sha256"],
                    d["status"],
                    ",".join(d["requirementIds"]),
                    d["reason"],
                    d["citation"],
                    d["packageRole"] or "",
                ]
            )
        )
    content_hash = sha256_bytes(("\n".join(pin_lines) + "\n").encode())

    complete = matrix["coverageDenominatorCompleteRecommended"]
    merge = {
        "schemaVersion": 1,
        "sliceId": "coverage-denominator-001",
        "coordinatorApply": True,
        "workerDidNotEditLedgers": True,
        "coverageDenominatorComplete": complete,
        "matrixPath": "parity/research/coverage-denominator-001/disposition-matrix.json",
        "matrixSha256": matrix_hash,
        "dispositionContentSha256": content_hash,
        "inventoryItemCount": len(items),
        "matrixItemCount": len(matrix_rows),
        "unresolvedCount": len(unresolved),
        "counts": counts,
        "inventoryPatches": [
            {
                "path": row["path"],
                "sha256": row["sha256"],
                "disposition": {
                    "status": row["disposition"]["status"],
                    "requirementIds": row["disposition"]["requirementIds"],
                    "reason": row["disposition"]["reason"],
                    "citation": row["disposition"]["citation"],
                    "packageRole": row["disposition"]["packageRole"],
                },
            }
            for row in matrix_rows
        ],
        "requirementsJsonPatch": {
            "coverageDenominatorComplete": complete,
            "note": (
                "Set true only after applying inventoryPatches so every inventory item "
                "disposition.status is not unassigned. Matrix hash pins the decision set."
                if complete
                else "Keep false; unresolved items remain."
            ),
        },
        "inventoryJsonPatch": {
            "status": "dispositions-assigned" if complete else "dispositions-pending",
            "note": "Replace each items[].disposition from inventoryPatches keyed by path+sha256.",
        },
    }

    merge_path = OUT / "merge-payload.json"
    merge_path.write_text(json.dumps(merge, indent=2) + "\n")

    unresolved_path = OUT / "unresolved.json"
    unresolved_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "unresolvedCount": len(unresolved),
                "unresolved": unresolved,
            },
            indent=2,
        )
        + "\n"
    )

    summary = {
        "matrixPath": str(matrix_path.relative_to(REPO)),
        "mergePayloadPath": str(merge_path.relative_to(REPO)),
        "matrixSha256": matrix_hash,
        "dispositionContentSha256": content_hash,
        "inventoryItemCount": len(items),
        "matrixItemCount": len(matrix_rows),
        "unresolvedCount": len(unresolved),
        "counts": counts,
        "coverageDenominatorCompleteRecommended": complete,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
