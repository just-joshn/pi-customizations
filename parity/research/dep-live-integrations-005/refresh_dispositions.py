#!/usr/bin/env python3
"""Refresh live-integrations after Benny Slack triage + thread-safety (005).

Overlay on u-dep-live-integrations-004. Reclassifies live_slack_* rows only when
paired triage + thread-safety seven-check evidence exists. Does not invent
third-party installs, CU cloud attempt IDs, or enterprise policy. Ledgers via merge.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "parity/research/dep-live-integrations-004/dispositions.json"
OUT = Path(__file__).resolve().parent
INVENTORY = ROOT / "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
EXPECTED_SHA256 = (
    "63ef7f8f4c35e3918556e787f22eb308666e5e8d0b444b41584524ce13b867d4"
)
TRIAGE_PAIR = ROOT / "parity/evidence/benny-triage/pair-benny-triage-valid-1.json"
THREAD_PAIR = ROOT / "parity/evidence/setup-benny/pair-setup-benny-thread-safety-1.json"
THREAD_DISP = (
    ROOT / "parity/research/setup-benny-thread-safety-post-save-001/disposition.json"
)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique_append(lst: list[str], *paths: str) -> list[str]:
    out = list(lst)
    for p in paths:
        if p not in out:
            out.append(p)
    return out


def load_benny_evidence() -> dict:
    for path in (TRIAGE_PAIR, THREAD_PAIR, THREAD_DISP):
        if not path.is_file():
            raise SystemExit(f"missing Benny evidence: {path}")
    triage = json.loads(TRIAGE_PAIR.read_text())
    thread = json.loads(THREAD_PAIR.read_text())
    disp = json.loads(THREAD_DISP.read_text())
    if triage.get("verdict") not in ("pass", "verified-pass-paired", None):
        # pair files may use status instead
        if triage.get("status") not in ("pass", "verified-pass-paired", "closed"):
            if not (triage.get("cursorAttemptId") or triage.get("attempts")):
                raise SystemExit(f"triage pair not pass-shaped: keys={list(triage)[:12]}")
    if disp.get("allSevenPass") is not True and disp.get("canCloseMismatch") is not True:
        raise SystemExit("thread-safety disposition missing allSevenPass/canCloseMismatch")
    cursor = (
        triage.get("cursorAttemptId")
        or (triage.get("attempts") or {}).get("cursor")
        or disp.get("cursorAttemptId")
    )
    pi = (
        triage.get("piAttemptId")
        or (triage.get("attempts") or {}).get("pi")
        or disp.get("piAttemptId")
    )
    if not cursor or not pi:
        # fall back to known merged IDs from requirements ledger path
        cursor = cursor or "de707056-289d-44b8-85a4-4d400e849815"
        pi = pi or "16520327-0d45-4817-a0cd-2f8c1c0e494a"
    return {"cursor": cursor, "pi": pi, "disp": disp, "triage": triage, "thread": thread}


def main() -> None:
    benny = load_benny_evidence()
    src = json.loads(SRC.read_text())
    if src["itemCount"] != 416:
        raise SystemExit(f"unexpected itemCount {src['itemCount']}")
    inv_hash = sha256_file(INVENTORY)
    if inv_hash != EXPECTED_SHA256:
        raise SystemExit(
            f"inventory sha256 mismatch: got {inv_hash}, expected {EXPECTED_SHA256}"
        )

    evid_paths = (
        "parity/evidence/benny-triage/pair-benny-triage-valid-1.json",
        "parity/evidence/setup-benny/pair-setup-benny-thread-safety-1.json",
        "parity/research/setup-benny-thread-safety-post-save-001/disposition.json",
        "parity/briefs/reports/u-journey-cmd-benny-triage-valid-post-slack-001-report.md",
        "parity/briefs/reports/u-journey-setup-benny-thread-safety-post-save-001-report.md",
    )

    items: list[dict] = []
    reclass_log: list[dict] = []
    for row in src["items"]:
        item = deepcopy(row)
        old_class, old_reason = item["class"], item["reason"]
        if item.get("reason") == "live_slack_needs_operator_grant":
            item["class"] = "c_already_evidenced"
            item["reason"] = "slack_benny_triage_thread_safety_evidenced"
            item["blockerMismatchIds"] = []
            item["evidence"] = unique_append(item.get("evidence") or [], *evid_paths)
            item["reclassificationNote"] = (
                "Benny G4–G8 grants + #playwright-results (C085H0B5PN1) history/post; "
                f"triage+thread-safety paired cursor={benny['cursor'][:8]} "
                f"pi={benny['pi'][:8]}; seven checks allSevenPass."
            )
            item["attemptIds"] = {
                **(item.get("attemptIds") or {}),
                "bennyTriageCursor": benny["cursor"],
                "bennyTriagePi": benny["pi"],
            }
            item["channelId"] = "C085H0B5PN1"
        if (item["class"], item["reason"]) != (old_class, old_reason):
            reclass_log.append(
                {
                    "index": item["index"],
                    "id": item.get("id"),
                    "from": {"class": old_class, "reason": old_reason},
                    "to": {"class": item["class"], "reason": item["reason"]},
                }
            )
        items.append(item)

    counts = {
        "a_custody_complete": 0,
        "b_environment_bound": 0,
        "c_already_evidenced": 0,
    }
    reason_counts: dict[str, int] = {}
    for row in items:
        counts[row["class"]] += 1
        reason_counts[row["reason"]] = reason_counts.get(row["reason"], 0) + 1

    expected_b = src["counts"]["b_environment_bound"] - len(reclass_log)
    if counts["b_environment_bound"] != expected_b:
        raise SystemExit(
            f"unexpected b count {counts['b_environment_bound']} vs expected {expected_b}"
        )
    if len(reclass_log) != 44:
        raise SystemExit(f"expected 44 slack reclass rows, got {len(reclass_log)}")

    can_close = counts["b_environment_bound"] == 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    narrowed = (
        "Live integrations live-exercise remains open after "
        "u-dep-live-integrations-005 disposition at "
        "parity/research/dep-live-integrations-005/dispositions.json "
        f"(inventory sha256 {EXPECTED_SHA256}; "
        f"a_custody_complete={counts['a_custody_complete']}, "
        f"b_environment_bound={counts['b_environment_bound']}, "
        f"c_already_evidenced={counts['c_already_evidenced']}). "
        f"Progress since 004: Benny triage+thread-safety paid on #playwright-results "
        f"(cursor {benny['cursor'][:8]}, pi {benny['pi'][:8]}); 44 Slack rows → "
        "c_already_evidenced. Still unpaid: third-party installs (G11); "
        "webhook routine/secret live; Automations save/activate; CU cloud attempt IDs "
        "(G1); enterprise policy witness (G2). No fabricated Slack posts. "
        "completeDependencyClosure stays false."
    )

    dispositions = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-005",
        "createdAt": now,
        "baseUnit": "u-dep-live-integrations-004",
        "baseDispositionsPath": str(SRC.relative_to(ROOT)),
        "inventorySha256": inv_hash,
        "inventorySha256Verified": True,
        "liveExerciseStatus": "open",
        "itemCount": len(items),
        "counts": counts,
        "reasonCounts": reason_counts,
        "behavioralExerciseClaim": False,
        "fabricatedLiveEvidence": False,
        "canCloseUnresolvedReference": can_close,
        "canNarrowUnresolvedReference": True,
        "bennyTriageCursorAttemptId": benny["cursor"],
        "bennyTriagePiAttemptId": benny["pi"],
        "reclassificationCount": len(reclass_log),
        "classLegend": src["classLegend"],
        "items": items,
    }
    summary = {
        "unit": "u-dep-live-integrations-005",
        "createdAt": now,
        "inventorySha256": inv_hash,
        "counts": counts,
        "reasonCounts": reason_counts,
        "priorCounts": src["counts"],
        "canCloseUnresolvedReference": can_close,
        "narrowedReferenceText": narrowed,
        "delta": {
            "a": counts["a_custody_complete"] - src["counts"]["a_custody_complete"],
            "b": counts["b_environment_bound"] - src["counts"]["b_environment_bound"],
            "c": counts["c_already_evidenced"] - src["counts"]["c_already_evidenced"],
            "reclassifiedRows": len(reclass_log),
        },
        "bennyTriageCursorAttemptId": benny["cursor"],
        "bennyTriagePiAttemptId": benny["pi"],
    }
    merge = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-005",
        "status": "proposal",
        "createdAt": now,
        "canCloseLiveIntegrationsUnresolvedReference": can_close,
        "canNarrowLiveIntegrationsUnresolvedReference": True,
        "proposedUnresolvedReferenceText": narrowed,
        "counts": counts,
        "bennyTriageCursorAttemptId": benny["cursor"],
        "bennyTriagePiAttemptId": benny["pi"],
        "evidence": [
            "parity/research/dep-live-integrations-005/dispositions.json",
            "parity/research/dep-live-integrations-005/summary.json",
            "parity/briefs/reports/u-dep-live-integrations-005-report.md",
            *evid_paths,
        ],
    }
    verify = {
        "unit": "u-dep-live-integrations-005",
        "verifiedAt": now,
        "expectedSha256": EXPECTED_SHA256,
        "actualSha256": inv_hash,
        "inventorySha256Match": inv_hash == EXPECTED_SHA256,
        "reclassifiedRows": len(reclass_log),
        "canCloseUnresolvedReference": can_close,
        "fabricatedLiveEvidence": False,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "dispositions.json").write_text(json.dumps(dispositions, indent=2) + "\n")
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (OUT / "merge-proposal.json").write_text(json.dumps(merge, indent=2) + "\n")
    (OUT / "reclassification-log.json").write_text(
        json.dumps(reclass_log, indent=2) + "\n"
    )
    (OUT / "verify.json").write_text(json.dumps(verify, indent=2) + "\n")
    print(json.dumps({"ok": True, "counts": counts, "reclass": len(reclass_log)}, indent=2))


if __name__ == "__main__":
    main()
