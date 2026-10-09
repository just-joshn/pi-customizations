#!/usr/bin/env python3
"""Prove scenario-wire-001 coverage against live requirements + proposal + files."""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
REQUIREMENTS_PATH = ROOT / "parity" / "requirements.json"
SCENARIOS_DIR = ROOT / "parity" / "scenarios"
PROPOSAL_PATH = Path(__file__).resolve().parent / "proposal.json"


def main() -> int:
    doc = json.loads(REQUIREMENTS_PATH.read_text())
    empty_ids = {
        r["id"] for r in doc["requirements"] if not r.get("scenarioIds")
    }
    proposal = json.loads(PROPOSAL_PATH.read_text())
    mappings = proposal["mappings"]
    mapped = {m["requirementId"]: m["scenarioId"] for m in mappings}

    missing = sorted(empty_ids - set(mapped))
    extra = sorted(set(mapped) - empty_ids)
    if missing or extra:
        print(
            json.dumps({"ok": False, "missing": missing, "extra": extra}, indent=2)
        )
        return 1

    failures: list[str] = []
    for req_id, sid in mapped.items():
        path = SCENARIOS_DIR / f"{sid}.json"
        if not path.is_file():
            failures.append(f"missing file for {req_id}: {path}")
            continue
        scenario = json.loads(path.read_text())
        if scenario.get("id") != sid:
            failures.append(f"{path}: id {scenario.get('id')!r} != {sid!r}")
        if req_id not in (scenario.get("requirements") or []):
            failures.append(f"{path}: requirements missing {req_id}")
        execution = scenario.get("execution") or {}
        if execution.get("pairId") is not None:
            failures.append(f"{path}: pairId must be null, got {execution.get('pairId')!r}")
        if execution.get("verdict") in {"pass-paired", "fail-paired"}:
            failures.append(f"{path}: fabricated paired verdict {execution.get('verdict')!r}")
        if scenario.get("status") == "executed-pass-paired" and execution.get("pairId") is None:
            failures.append(f"{path}: pass-paired status without pairId")

    sample_ids = sorted(mapped.values())
    rng = random.Random(1)
    spot = sample_ids if len(sample_ids) <= 5 else rng.sample(sample_ids, 5)
    spot_ok = []
    for sid in spot:
        path = SCENARIOS_DIR / f"{sid}.json"
        scenario = json.loads(path.read_text())
        assert scenario["execution"]["pairId"] is None
        spot_ok.append(
            {
                "id": sid,
                "pairId": scenario["execution"]["pairId"],
                "verdict": scenario["execution"]["verdict"],
                "status": scenario["status"],
            }
        )

    if failures:
        print(json.dumps({"ok": False, "failures": failures}, indent=2))
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "emptyCount": len(empty_ids),
                "proposed": proposal["counts"]["proposed"],
                "written": proposal["counts"]["written"],
                "reused": proposal["counts"]["reused"],
                "spotCheck": spot_ok,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
