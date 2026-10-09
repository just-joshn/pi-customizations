#!/usr/bin/env python3
"""Refresh live-integrations after make-bot Generate/key/probe (004).

Overlay on u-dep-live-integrations-003. Fail-closed: refuses to reclassify
webhook Generate rows unless post-unlock disposition proves key_server_ok.
Does not invent Slack/Benny. Ledgers untouched (merge proposal only).
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "parity/research/dep-live-integrations-003/dispositions.json"
OUT = Path(__file__).resolve().parent
INVENTORY = ROOT / "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
EXPECTED_SHA256 = (
    "63ef7f8f4c35e3918556e787f22eb308666e5e8d0b444b41584524ce13b867d4"
)
MAKEBOT_DISP = (
    ROOT / "parity/research/make-bot-auth-header-post-unlock-002/disposition.json"
)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique_append(lst: list[str], *paths: str) -> list[str]:
    out = list(lst)
    for p in paths:
        if p not in out:
            out.append(p)
    return out


def load_makebot() -> dict:
    if not MAKEBOT_DISP.is_file():
        raise SystemExit(
            "missing make-bot post-unlock disposition; refuse Generate reclass"
        )
    disp = json.loads(MAKEBOT_DISP.read_text())
    outcome = disp.get("cursorOutcome") or disp.get("outcome")
    probe = disp.get("probe") or {}
    if outcome != "key_server_ok" and not (
        probe.get("ok") is True and probe.get("httpStatus") == 200
    ):
        raise SystemExit(
            f"make-bot disposition not key_server_ok: {outcome!r} "
            f"blocker={disp.get('blocker')!r}"
        )
    if disp.get("senderKeyInChatOrEvidence") or disp.get("keyLeak"):
        raise SystemExit("make-bot disposition flags key leak; refuse")
    attempt = disp.get("attemptId")
    if not attempt:
        raise SystemExit("make-bot disposition missing attemptId")
    return disp


def main() -> None:
    makebot = load_makebot()
    attempt = makebot["attemptId"]
    src = json.loads(SRC.read_text())
    if src["itemCount"] != 416:
        raise SystemExit(f"unexpected itemCount {src['itemCount']}")
    inv_hash = sha256_file(INVENTORY)
    if inv_hash != EXPECTED_SHA256:
        raise SystemExit(
            f"inventory sha256 mismatch: got {inv_hash}, expected {EXPECTED_SHA256}"
        )

    evid_paths = (
        "parity/research/make-bot-auth-header-post-unlock-002/disposition.json",
        "parity/briefs/reports/u-make-bot-auth-header-post-unlock-002-report.md",
        f"parity/evidence/make-bot-ui/auth-header-post-unlock-002/{attempt}/",
    )

    items: list[dict] = []
    reclass_log: list[dict] = []
    for row in src["items"]:
        item = deepcopy(row)
        old_class, old_reason = item["class"], item["reason"]
        if item.get("reason") == "webhook_create_witnessed_generate_auth_unpaid":
            item["class"] = "c_already_evidenced"
            item["reason"] = "webhook_generate_key_probe_evidenced"
            item["blockerMismatchIds"] = []
            item["evidence"] = unique_append(item.get("evidence") or [], *evid_paths)
            item["reclassificationNote"] = (
                f"Generate + 0600 store + probe 200 paid ({attempt[:8]}). "
                "Pi half e75f8e08. No Activate required for key_server boundary."
            )
            item["attemptIds"] = {
                **(item.get("attemptIds") or {}),
                "generateAuthProbe": attempt,
                "piKeyServerOk": "e75f8e08-0d8c-4d55-ad3f-6946c405bbaf",
            }
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

    if counts["b_environment_bound"] != src["counts"]["b_environment_bound"] - len(
        reclass_log
    ):
        # sanity: each reclass should drop one from b
        expected_b = src["counts"]["b_environment_bound"] - len(reclass_log)
        if counts["b_environment_bound"] != expected_b:
            raise SystemExit(
                f"unexpected b count {counts['b_environment_bound']} vs expected {expected_b}"
            )

    blocker_mismatch_ids = sorted(
        {
            mid
            for row in items
            if row["class"] == "b_environment_bound"
            for mid in row.get("blockerMismatchIds") or []
        }
    )
    can_close = counts["b_environment_bound"] == 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    narrowed = (
        "Live integrations live-exercise remains open after "
        "u-dep-live-integrations-004 disposition at "
        "parity/research/dep-live-integrations-004/dispositions.json "
        f"(inventory sha256 {EXPECTED_SHA256}; "
        f"a_custody_complete={counts['a_custody_complete']}, "
        f"b_environment_bound={counts['b_environment_bound']}, "
        f"c_already_evidenced={counts['c_already_evidenced']}). "
        f"Progress since 003: make-bot Generate/key/probe paid ({attempt[:8]}). "
        "Still unpaid: Benny triage valid-config (Slack G4–G8); thread-safety seven "
        "live checks; third-party installs; CU cloud attempt IDs (G1); enterprise "
        "policy witness (G2). No fabricated Slack posts. "
        "completeDependencyClosure stays false."
    )

    dispositions = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-004",
        "createdAt": now,
        "baseUnit": "u-dep-live-integrations-003",
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
        "blockerMismatchIds": blocker_mismatch_ids,
        "makeBotAttemptId": attempt,
        "reclassificationCount": len(reclass_log),
        "classLegend": src["classLegend"],
        "items": items,
    }
    summary = {
        "unit": "u-dep-live-integrations-004",
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
        "makeBotAttemptId": attempt,
    }
    merge = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-004",
        "status": "proposal",
        "createdAt": now,
        "canCloseLiveIntegrationsUnresolvedReference": can_close,
        "canNarrowLiveIntegrationsUnresolvedReference": True,
        "proposedUnresolvedReferenceText": narrowed,
        "counts": counts,
        "makeBotAttemptId": attempt,
        "evidence": [
            "parity/research/dep-live-integrations-004/dispositions.json",
            "parity/research/dep-live-integrations-004/summary.json",
            "parity/briefs/reports/u-dep-live-integrations-004-report.md",
            *evid_paths,
        ],
    }
    verify = {
        "unit": "u-dep-live-integrations-004",
        "verifiedAt": now,
        "expectedSha256": EXPECTED_SHA256,
        "actualSha256": inv_hash,
        "inventorySha256Match": inv_hash == EXPECTED_SHA256,
        "makeBotOutcome": makebot.get("cursorOutcome"),
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
