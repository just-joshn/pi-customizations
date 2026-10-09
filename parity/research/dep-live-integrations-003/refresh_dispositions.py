#!/usr/bin/env python3
"""Refresh live-integrations dispositions after Pi creation-boundary (003).

Overlay on u-dep-live-integrations-002. Rerunnable. Does not invent Generate/Slack.
Ledgers are coordinator-owned; this writes research + merge proposal only.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "parity/research/dep-live-integrations-002/dispositions.json"
OUT = Path(__file__).resolve().parent
INVENTORY = ROOT / "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
EXPECTED_SHA256 = (
    "63ef7f8f4c35e3918556e787f22eb308666e5e8d0b444b41584524ce13b867d4"
)

ATTEMPT = {
    "url_editor": "f6e29fb7-5878-4c8c-841e-1538b39d1cf7",
    "automate_handoff": "b60a705b-e2ea-40c4-adeb-7014fde433b4",
    "webhook_create": "c345b7ed-5c24-424c-86c3-55211b7bf0c8",
    "benny_editor_title": "475ab346-80a0-4d73-8ae1-d2b8042ee66f",
    "benny_list": "e11d7225-4c8a-4c09-8f30-273e941a52d2",
    "benny_title_reverify": "2c525e93-3392-4253-81ef-dd965fde2e7d",
    "pi_creation_blocked_prior": "f4c7eec5-6ac5-4431-b4b1-23c7e267dc96",
    "pi_creation_paired": "4d40a1d5-ea54-4ce2-922b-bf82e78b6577",
    "enterprise_observe_002": "2026-10-09T10:54:00Z-state.vscdb",
}

EVIDENCE = {
    "pi_creation_pair": (
        "parity/evidence/setup-benny/pair-setup-benny-creation-boundary-1.json"
    ),
    "pi_creation_report": (
        "parity/briefs/reports/u-journey-setup-benny-creation-pi-002-report.md"
    ),
    "pi_creation_attempt": (
        "parity/evidence/setup-benny/creation-boundary/pi/"
        "4d40a1d5-ea54-4ce2-922b-bf82e78b6577/"
    ),
    "adapter_automate": (
        "parity/briefs/reports/u-pi-setup-benny-adapter-automate-001-report.md"
    ),
    "enterprise_002": (
        "parity/briefs/reports/u-dep-enterprise-observe-002-report.md"
    ),
    "thread_safety_tool": (
        "extensions/pi-pstack/src/automations.ts#AutomationRecordThreadSafety"
    ),
}

CREATE_PATH_INDEXES = {83, 152, 229, 391}
AUTOMATIONS_REMAIN_INDEXES = {75, 149, 150}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique_append(lst: list[str], *paths: str) -> list[str]:
    out = list(lst)
    for p in paths:
        if p not in out:
            out.append(p)
    return out


def main() -> None:
    src = json.loads(SRC.read_text())
    if src["itemCount"] != 416:
        raise SystemExit(f"unexpected itemCount {src['itemCount']}")
    inv_hash = sha256_file(INVENTORY)
    if inv_hash != EXPECTED_SHA256:
        raise SystemExit(
            f"inventory sha256 mismatch: got {inv_hash}, expected {EXPECTED_SHA256}"
        )

    items: list[dict] = []
    note_log: list[dict] = []
    for row in src["items"]:
        item = deepcopy(row)
        idx = item["index"]
        old_class, old_reason = item["class"], item["reason"]
        touched = False

        if idx in CREATE_PATH_INDEXES:
            item["evidence"] = unique_append(
                item.get("evidence") or [],
                EVIDENCE["pi_creation_pair"],
                EVIDENCE["pi_creation_report"],
                EVIDENCE["pi_creation_attempt"],
                EVIDENCE["adapter_automate"],
            )
            item["reclassificationNote"] = (
                "Editor create/open paid on Cursor + Pi Method A "
                f"({ATTEMPT['pi_creation_paired'][:8]}); "
                "PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001 verified-pass-paired. "
                "Save/Activate for live Slack traffic and thread-safety seven-checks "
                "remain unpaid elsewhere."
            )
            attempt_ids = dict(item.get("attemptIds") or {})
            attempt_ids["piCreationPaired"] = ATTEMPT["pi_creation_paired"]
            attempt_ids.pop("piCreationBlocked", None)
            item["attemptIds"] = attempt_ids
            touched = True
        elif idx in AUTOMATIONS_REMAIN_INDEXES:
            item["evidence"] = unique_append(
                item.get("evidence") or [],
                EVIDENCE["pi_creation_pair"],
                EVIDENCE["thread_safety_tool"],
            )
            item["reclassificationNote"] = (
                "Create/open + Pi disabled Save paid for creation-boundary. "
                "Fragment still needs operator Save/Activate for live Slack paths "
                "and SETUP-BENNY-THREAD-SAFETY-ENV seven-checks."
            )
            touched = True
        elif item.get("reason") == "webhook_create_witnessed_generate_auth_unpaid":
            item["reclassificationNote"] = (
                "Incoming HTTP webhook create + Generate chrome once witnessed "
                f"({ATTEMPT['webhook_create'][:8]}). Generate auth header, 0600 "
                "key store, and probe remain unpaid (IOConsoleLocked; G10). "
                "Pi half e75f8e08 already key_server_ok."
            )
            touched = True

        if touched or (item["class"], item["reason"]) != (old_class, old_reason):
            note_log.append(
                {
                    "index": idx,
                    "id": item.get("id"),
                    "from": {"class": old_class, "reason": old_reason},
                    "to": {"class": item["class"], "reason": item["reason"]},
                    "noteOnly": (item["class"], item["reason"])
                    == (old_class, old_reason),
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

    if counts != src["counts"]:
        raise SystemExit(
            f"003 must not change class counts without new live evidence; "
            f"got {counts} vs prior {src['counts']}"
        )

    blocker_mismatch_ids = sorted(
        {
            mid
            for row in items
            if row["class"] == "b_environment_bound"
            for mid in row.get("blockerMismatchIds") or []
        }
    )
    for forbidden in ("SETUP-BENNY-CREATION-BOUNDARY-ENV",):
        if forbidden in blocker_mismatch_ids:
            raise SystemExit(f"{forbidden} must not remain in blockers")

    can_close = counts["b_environment_bound"] == 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    narrowed = (
        "Live integrations live-exercise remains open after "
        "u-dep-live-integrations-003 disposition at "
        "parity/research/dep-live-integrations-003/dispositions.json "
        f"(inventory sha256 {EXPECTED_SHA256}; "
        f"a_custody_complete={counts['a_custody_complete']}, "
        f"b_environment_bound={counts['b_environment_bound']}, "
        f"c_already_evidenced={counts['c_already_evidenced']}). "
        "Progress since 002: PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001 "
        f"verified-pass-paired (Pi {ATTEMPT['pi_creation_paired'][:8]} + Cursor "
        f"{ATTEMPT['benny_list'][:8]}/{ATTEMPT['benny_editor_title'][:8]}); "
        "Pi host /automate + AutomationRecordThreadSafety/Enable(local)/Disable; "
        "setup-benny adapter on /automate; enterprise observe-002 still "
        "pro_plus/no-team. Still unpaid: make-bot Generate/key/probe (G10 console "
        "lock); Benny triage valid-config (Slack G4–G8); thread-safety seven live "
        "checks; third-party installs; CU cloud attempt IDs (G1); enterprise "
        "policy witness (G2). No fabricated Slack posts or Generate auth. "
        "completeDependencyClosure stays false."
    )

    dispositions = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-003",
        "createdAt": now,
        "baseUnit": "u-dep-live-integrations-002",
        "baseDispositionsPath": (
            "parity/research/dep-live-integrations-002/dispositions.json"
        ),
        "inventoryPath": (
            "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
        ),
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
        "removedBlockerMismatchIds": ["SETUP-BENNY-CREATION-BOUNDARY-ENV"],
        "removedBlockerNote": (
            "SETUP-BENNY-CREATION-BOUNDARY-ENV remains closed-env-resolved; "
            "requirement PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001 is now "
            f"verified-pass-paired (Pi {ATTEMPT['pi_creation_paired']})."
        ),
        "attemptIds": ATTEMPT,
        "classLegend": src["classLegend"],
        "noteRefreshCount": len(note_log),
        "items": items,
    }

    summary = {
        "unit": "u-dep-live-integrations-003",
        "createdAt": now,
        "inventorySha256": inv_hash,
        "counts": counts,
        "reasonCounts": reason_counts,
        "priorCounts": src["counts"],
        "priorReasonCounts": src["reasonCounts"],
        "canCloseUnresolvedReference": can_close,
        "canNarrowUnresolvedReference": True,
        "blockerMismatchIds": blocker_mismatch_ids,
        "behavioralExerciseClaim": False,
        "attemptIds": ATTEMPT,
        "narrowedReferenceText": narrowed,
        "delta": {
            "a": 0,
            "b": 0,
            "c": 0,
            "noteRefreshedRows": len(note_log),
        },
        "makeBotGenerateStatus": "unpaid_console_locked",
        "consoleLockedAtRun": True,
    }

    merge = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-003",
        "status": "proposal",
        "createdAt": now,
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
            "progressMd": "parity/progress.md",
            "sourceLockJson": "parity/source-lock.json",
        },
        "canCloseLiveIntegrationsUnresolvedReference": can_close,
        "canNarrowLiveIntegrationsUnresolvedReference": True,
        "closeRationale": (
            "Cannot close: b_environment_bound remains 115 (make-bot Generate, "
            "Benny/Slack, thread-safety live, third-party, CU cloud, enterprise)."
        ),
        "narrowRationale": (
            "Refresh stale 002 text that claimed Pi Automations absent / creation "
            "unverified. Creation-boundary now verified-pass-paired. Do not move "
            "webhook Generate rows without post-unlock evidence. Do not set "
            "completeDependencyClosure true."
        ),
        "behavioralExerciseClaim": False,
        "inventorySha256": inv_hash,
        "counts": counts,
        "reasonCounts": reason_counts,
        "attemptIds": ATTEMPT,
        "proposedUnresolvedReferenceText": narrowed,
        "ledgerEdits": {
            "dependencies.unresolvedReferences": [narrowed],
            "dependencies.liveIntegrations003Note": (
                "u-dep-live-integrations-003: note refresh only; counts unchanged "
                "a=275 b=115 c=26; canCloseUnresolvedReference=false."
            ),
            "sourceLock.completeDependencyClosure": False,
        },
        "evidence": [
            "parity/research/dep-live-integrations-003/dispositions.json",
            "parity/research/dep-live-integrations-003/summary.json",
            "parity/briefs/reports/u-dep-live-integrations-003-report.md",
            EVIDENCE["pi_creation_pair"],
            EVIDENCE["pi_creation_report"],
            EVIDENCE["adapter_automate"],
            EVIDENCE["enterprise_002"],
        ],
    }

    verify = {
        "unit": "u-dep-live-integrations-003",
        "verifiedAt": now,
        "expectedSha256": EXPECTED_SHA256,
        "actualSha256": inv_hash,
        "inventorySha256Match": inv_hash == EXPECTED_SHA256,
        "countsUnchangedFrom002": counts == src["counts"],
        "canCloseUnresolvedReference": can_close,
        "fabricatedLiveEvidence": False,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "dispositions.json").write_text(json.dumps(dispositions, indent=2) + "\n")
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (OUT / "merge-proposal.json").write_text(json.dumps(merge, indent=2) + "\n")
    (OUT / "note-refresh-log.json").write_text(json.dumps(note_log, indent=2) + "\n")
    (OUT / "verify.json").write_text(json.dumps(verify, indent=2) + "\n")
    print(json.dumps({"ok": True, "counts": counts, "notes": len(note_log)}, indent=2))


if __name__ == "__main__":
    main()
