#!/usr/bin/env python3
"""Generate draft scenario JSON + merge proposal for empty-scenario requirements.

Rerunnable. Does not edit requirements.json. Does not overwrite protected scenario files.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
REQUIREMENTS_PATH = ROOT / "parity" / "requirements.json"
SCENARIOS_DIR = ROOT / "parity" / "scenarios"
OUT_DIR = Path(__file__).resolve().parent
PROPOSAL_PATH = OUT_DIR / "proposal.json"
MANIFEST_PATH = OUT_DIR / "written-manifest.json"

PROTECTED_STEMS = frozenset(
    {
        "mode-one-message",
        "mode-sticky",
        "setup-model-discovery",
        "setup-budget-labels",
    }
)
JOURNEY_FAMILY_PREFIX = "journey-family-"
ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")


def scenario_id_for(requirement_id: str) -> str:
    body = requirement_id
    if body.startswith("PSTACK-"):
        body = body[len("PSTACK-") :]
    body = re.sub(r"-\d+$", "", body)
    sid = body.lower().replace("_", "-")
    if not ID_RE.match(sid):
        raise ValueError(f"invalid scenario id derived from {requirement_id!r}: {sid!r}")
    return sid


def source_string(source: dict) -> str:
    file_part = source.get("file") or "unknown"
    locator = source.get("locator")
    if locator:
        return f"{file_part}#{locator}"
    return str(file_part)


def convert_actions(req: dict) -> list[dict]:
    actions_out: list[dict] = []
    for action in req.get("actions") or []:
        if not isinstance(action, dict):
            continue
        raw_input = (action.get("input") or "").strip()
        expect = (
            action.get("expectedObservation")
            or action.get("expect")
            or req.get("trigger")
            or "Record observation for requirement action."
        )
        if raw_input.startswith("/"):
            # Slash command path: first token is the literal to type.
            literal = raw_input.split()[0]
            actions_out.append(
                {
                    "kind": "type",
                    "literal": literal,
                    "expect": expect,
                }
            )
        elif raw_input:
            actions_out.append(
                {
                    "kind": "observe",
                    "expect": f"{raw_input}. {expect}",
                }
            )
        else:
            actions_out.append({"kind": "observe", "expect": expect})

    if not actions_out:
        trigger = (req.get("trigger") or "").strip() or "Exercise the requirement trigger."
        actions_out.append({"kind": "observe", "expect": trigger})
    return actions_out


def build_scenario(req: dict, scenario_id: str) -> dict:
    source = req.get("source") or {}
    revision = source.get("revision") or "ccb5507cec1546dc88135c1139c811e6c59115ba"
    starting = (req.get("startingState") or "").strip()
    preconditions = req.get("preconditions") or []
    fixture_bits = []
    if starting:
        fixture_bits.append(starting)
    if preconditions:
        fixture_bits.append("Preconditions: " + "; ".join(preconditions))
    fixture_description = (
        " ".join(fixture_bits)
        if fixture_bits
        else f"Draft fixture for {req['id']}; not established."
    )
    return {
        "schemaVersion": 1,
        "id": scenario_id,
        "status": "draft-awaiting-pair",
        "requirements": [req["id"]],
        "referenceRevision": revision,
        "source": source_string(source) if isinstance(source, dict) else str(source),
        "configurationIds": list(req.get("configurationIds") or ["default"]),
        "fixture": {
            "description": fixture_description,
            "digest": None,
        },
        "actions": convert_actions(req),
        "execution": {
            "pairId": None,
            "verdict": "unverified",
        },
    }


def is_writable_scenario_path(path: Path) -> bool:
    stem = path.stem
    if stem in PROTECTED_STEMS:
        return False
    if stem.startswith(JOURNEY_FAMILY_PREFIX):
        return False
    return True


def main() -> None:
    doc = json.loads(REQUIREMENTS_PATH.read_text())
    requirements = doc["requirements"]
    empty = [r for r in requirements if not r.get("scenarioIds")]

    existing_stems = {p.stem for p in SCENARIOS_DIR.glob("*.json")}
    mappings: list[dict] = []
    written: list[str] = []
    reused: list[str] = []

    for req in empty:
        sid = scenario_id_for(req["id"])
        path = SCENARIOS_DIR / f"{sid}.json"

        if sid in existing_stems and path.exists():
            # Reuse only when an existing file already has the required draft shape
            # and lists this requirement. Never overwrite protected/journey-family files.
            if not is_writable_scenario_path(path):
                raise SystemExit(
                    f"derived id {sid} collides with protected/journey file; rename needed"
                )
            existing = json.loads(path.read_text())
            reqs = existing.get("requirements") or []
            if req["id"] in reqs and existing.get("status") == "draft-awaiting-pair":
                reused.append(sid)
                mappings.append(
                    {
                        "requirementId": req["id"],
                        "scenarioId": sid,
                        "action": "reused",
                    }
                )
                continue
            raise SystemExit(
                f"refusing to overwrite existing non-reusable scenario {path}"
            )

        scenario = build_scenario(req, sid)
        if not is_writable_scenario_path(path):
            raise SystemExit(f"refusing write to protected path {path}")
        path.write_text(json.dumps(scenario, indent=2) + "\n")
        written.append(sid)
        existing_stems.add(sid)
        mappings.append(
            {
                "requirementId": req["id"],
                "scenarioId": sid,
                "action": "written",
            }
        )

    proposal = {
        "schemaVersion": 1,
        "id": "scenario-wire-001",
        "kind": "requirement-scenario-wire-proposal",
        "status": "awaiting-coordinator-merge",
        "forbidden": [
            "Do not invent pair verdicts.",
            "Coordinator merges into parity/requirements.json; worker must not edit it.",
        ],
        "counts": {
            "proposed": len(mappings),
            "written": len(written),
            "reused": len(reused),
            "emptyRequirementsAtGeneration": len(empty),
        },
        "mappings": mappings,
        "mergeInstructions": {
            "forEachMapping": "Append mapping.scenarioId to requirements[id==requirementId].scenarioIds if absent.",
            "doNotChange": [
                "execution verdicts on existing paired scenarios",
                "mismatches.json",
                "progress.md",
            ],
        },
    }
    PROPOSAL_PATH.write_text(json.dumps(proposal, indent=2) + "\n")
    MANIFEST_PATH.write_text(
        json.dumps(
            {
                "written": written,
                "reused": reused,
                "proposed": len(mappings),
            },
            indent=2,
        )
        + "\n"
    )
    print(
        json.dumps(
            {
                "proposed": len(mappings),
                "written": len(written),
                "reused": len(reused),
                "proposal": str(PROPOSAL_PATH.relative_to(ROOT)),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
