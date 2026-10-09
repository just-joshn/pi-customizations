#!/usr/bin/env python3
"""Refresh live-integrations dispositions after Automations/webhook progress (002).

Overlay on u-dep-live-integrations-001. Rerunnable. Does not edit ledgers.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "parity/research/dep-live-integrations-001/dispositions.json"
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
    "pi_creation_blocked": "f4c7eec5-6ac5-4431-b4b1-23c7e267dc96",
}

EVIDENCE = {
    "url_editor": (
        "parity/evidence/setup-benny/creation-boundary/web/"
        "f6e29fb7-5878-4c8c-841e-1538b39d1cf7/"
    ),
    "automate_handoff": (
        "parity/evidence/setup-benny/creation-boundary/agents-window/"
        "b60a705b-e2ea-40c4-adeb-7014fde433b4/"
    ),
    "webhook_create": (
        "parity/evidence/make-bot-ui/automations-editor/"
        "c345b7ed-5c24-424c-86c3-55211b7bf0c8/"
    ),
    "benny_editor_title": (
        "parity/evidence/make-bot-ui/auth-header-probe/"
        "475ab346-80a0-4d73-8ae1-d2b8042ee66f/"
    ),
    "benny_list": (
        "parity/evidence/setup-benny/creation-boundary/agents-window/"
        "e11d7225-4c8a-4c09-8f30-273e941a52d2/"
    ),
    "pi_blocked": (
        "parity/evidence/setup-benny/creation-boundary/pi/"
        "f4c7eec5-6ac5-4431-b4b1-23c7e267dc96/"
    ),
    "creation_env_closed": (
        "parity/mismatches.json#SETUP-BENNY-CREATION-BOUNDARY-ENV"
    ),
}

CREATE_PATH_INDEXES = {83, 152, 229, 391}
AUTOMATIONS_REMAIN_INDEXES = {75, 149, 150}
WEBHOOK_CREATE_WITNESSED_PATTERNS = (
    "cloud-agent/api/webhooks",
    "docs_cloud-agent_api_webhooks",
    "webhook-triggers",
    "make-bot",
    "make_bot",
)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def drop_creation_boundary(blockers: list[str]) -> list[str]:
    return [b for b in blockers if b != "SETUP-BENNY-CREATION-BOUNDARY-ENV"]


def unique_append(lst: list[str], *paths: str) -> list[str]:
    out = list(lst)
    for p in paths:
        if p not in out:
            out.append(p)
    return out


def is_webhook_create_witnessed(item: dict) -> bool:
    blob = " ".join(
        "" if v is None else str(v)
        for v in (
            item.get("id"),
            item.get("url"),
            item.get("matchedPattern"),
            item.get("ownedBehavior"),
        )
    ).lower()
    return any(p in blob for p in WEBHOOK_CREATE_WITNESSED_PATTERNS)


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
    reclass_log: list[dict] = []
    for row in src["items"]:
        item = deepcopy(row)
        idx = item["index"]
        old_class, old_reason = item["class"], item["reason"]

        if idx in CREATE_PATH_INDEXES:
            item["class"] = "c_already_evidenced"
            item["reason"] = "automations_editor_create_handoff_evidenced"
            item["blockerMismatchIds"] = []
            item["evidence"] = unique_append(
                [],
                EVIDENCE["url_editor"],
                EVIDENCE["automate_handoff"],
                EVIDENCE["benny_list"],
                EVIDENCE["benny_editor_title"],
                EVIDENCE["creation_env_closed"],
                "parity/mismatches.json#SETUP-BENNY-THREAD-SAFETY-ENV",
            )
            item["reclassificationNote"] = (
                "Editor create/open paid via /automations/new and /automate; "
                "Save/Activate and Slack thread-safety remain unpaid elsewhere."
            )
            item["attemptIds"] = {
                "urlEditor": ATTEMPT["url_editor"],
                "automateHandoff": ATTEMPT["automate_handoff"],
                "bennyList": ATTEMPT["benny_list"],
                "bennyEditorTitle": ATTEMPT["benny_editor_title"],
                "piCreationBlocked": ATTEMPT["pi_creation_blocked"],
            }
        elif idx in AUTOMATIONS_REMAIN_INDEXES:
            item["class"] = "b_environment_bound"
            item["reason"] = (
                "automations_editor_save_or_activate_needs_operator_grant"
            )
            item["blockerMismatchIds"] = ["SETUP-BENNY-THREAD-SAFETY-ENV"]
            item["evidence"] = unique_append(
                [
                    e
                    for e in (item.get("evidence") or [])
                    if e != EVIDENCE["creation_env_closed"]
                ],
                EVIDENCE["url_editor"],
                EVIDENCE["automate_handoff"],
                EVIDENCE["creation_env_closed"],
                "parity/mismatches.json#SETUP-BENNY-THREAD-SAFETY-ENV",
            )
            item["reclassificationNote"] = (
                "Create/open harness paid; fragment still needs Save/Activate "
                "or live exercise. CREATION-BOUNDARY closed-env-resolved; "
                "THREAD-SAFETY remains."
            )
            item["attemptIds"] = {
                "urlEditor": ATTEMPT["url_editor"],
                "automateHandoff": ATTEMPT["automate_handoff"],
            }
        elif old_reason == "webhook_routine_or_secret_live_needs_operator_grant":
            item["blockerMismatchIds"] = ["MAKE-BOT-UI-KEY-SERVER-HOST"]
            item["evidence"] = unique_append(
                item.get("evidence") or [],
                EVIDENCE["webhook_create"],
                "parity/mismatches.json#MAKE-BOT-UI-KEY-SERVER-HOST",
            )
            item["attemptIds"] = {"webhookCreate": ATTEMPT["webhook_create"]}
            if is_webhook_create_witnessed(item):
                item["reason"] = (
                    "webhook_create_witnessed_generate_auth_unpaid"
                )
                item["reclassificationNote"] = (
                    "Incoming HTTP webhook create + Generate chrome once "
                    "witnessed (c345b7ed). Generate auth header capture, "
                    "0600 key store, and probe remain unpaid (console locked)."
                )
            else:
                item["reclassificationNote"] = (
                    "Webhook create witness exists for Automations path; "
                    "secrets/routines live path still unpaid."
                )
        elif old_reason == "automations_editor_runtime_needs_operator_grant":
            item["blockerMismatchIds"] = drop_creation_boundary(
                item.get("blockerMismatchIds") or []
            ) or ["SETUP-BENNY-THREAD-SAFETY-ENV"]
            item["reason"] = (
                "automations_editor_save_or_activate_needs_operator_grant"
            )
        elif item.get("blockerMismatchIds"):
            item["blockerMismatchIds"] = drop_creation_boundary(
                item["blockerMismatchIds"]
            )

        if (item["class"], item["reason"]) != (old_class, old_reason) or idx in (
            CREATE_PATH_INDEXES | AUTOMATIONS_REMAIN_INDEXES
        ):
            reclass_log.append(
                {
                    "index": idx,
                    "id": item.get("id"),
                    "from": {"class": old_class, "reason": old_reason},
                    "to": {"class": item["class"], "reason": item["reason"]},
                    "blockerMismatchIds": item.get("blockerMismatchIds"),
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

    blocker_mismatch_ids = sorted(
        {
            mid
            for row in items
            if row["class"] == "b_environment_bound"
            for mid in row.get("blockerMismatchIds") or []
        }
    )
    if "SETUP-BENNY-CREATION-BOUNDARY-ENV" in blocker_mismatch_ids:
        raise SystemExit("CREATION-BOUNDARY must not remain in blockers")

    can_close = counts["b_environment_bound"] == 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    narrowed = (
        "Live integrations live-exercise remains open after "
        "u-dep-live-integrations-002 disposition at "
        "parity/research/dep-live-integrations-002/dispositions.json "
        f"(inventory sha256 {EXPECTED_SHA256}; "
        f"a_custody_complete={counts['a_custody_complete']}, "
        f"b_environment_bound={counts['b_environment_bound']}, "
        f"c_already_evidenced={counts['c_already_evidenced']}). "
        "Progress: Automations editor create/open paid "
        f"(url {ATTEMPT['url_editor'][:8]}, "
        f"/automate {ATTEMPT['automate_handoff'][:8]}, "
        f"Benny Inactive+title {ATTEMPT['benny_list'][:8]}/"
        f"{ATTEMPT['benny_editor_title'][:8]}); "
        "SETUP-BENNY-CREATION-BOUNDARY-ENV closed-env-resolved; "
        f"webhook create witnessed ({ATTEMPT['webhook_create'][:8]}). "
        "Still unpaid: Benny/Slack valid-config + thread-safety; "
        "make-bot Generate auth + key store + probe; "
        "third-party live installs (Linear/Notion/GitHub/GitLab/Teams); "
        "CU cloud helper live exercise; enterprise policy observation. "
        f"Pi Automations editor absent ({ATTEMPT['pi_creation_blocked'][:8]}). "
        "No fabricated Slack posts, Generate auth, or invented update_state. "
        "completeDependencyClosure stays false."
    )

    dispositions = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-002",
        "createdAt": now,
        "baseUnit": "u-dep-live-integrations-001",
        "baseDispositionsPath": (
            "parity/research/dep-live-integrations-001/dispositions.json"
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
            "SETUP-BENNY-CREATION-BOUNDARY-ENV status closed-env-resolved; "
            "requirement PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001 stays "
            "unverified (Pi editor absent f4c7eec5)."
        ),
        "attemptIds": ATTEMPT,
        "classLegend": src["classLegend"],
        "reclassificationCount": len(reclass_log),
        "items": items,
    }

    summary = {
        "unit": "u-dep-live-integrations-002",
        "createdAt": now,
        "inventorySha256": inv_hash,
        "counts": counts,
        "reasonCounts": reason_counts,
        "priorCounts": src["counts"],
        "priorReasonCounts": src["reasonCounts"],
        "canCloseUnresolvedReference": can_close,
        "canNarrowUnresolvedReference": True,
        "blockerMismatchIds": blocker_mismatch_ids,
        "removedBlockerMismatchIds": ["SETUP-BENNY-CREATION-BOUNDARY-ENV"],
        "behavioralExerciseClaim": False,
        "attemptIds": ATTEMPT,
        "narrowedReferenceText": narrowed,
        "delta": {
            "a": counts["a_custody_complete"] - src["counts"]["a_custody_complete"],
            "b": counts["b_environment_bound"] - src["counts"]["b_environment_bound"],
            "c": counts["c_already_evidenced"] - src["counts"]["c_already_evidenced"],
            "reclassifiedRows": len(reclass_log),
        },
    }

    merge = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-002",
        "status": "proposal",
        "createdAt": now,
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
            "progressMd": "parity/progress.md",
        },
        "canCloseLiveIntegrationsUnresolvedReference": can_close,
        "canNarrowLiveIntegrationsUnresolvedReference": True,
        "closeRationale": (
            "Cannot close: environment-bound live surfaces remain unpaid "
            "(Benny/Slack, make-bot Generate/auth, third-party, CU cloud, "
            "enterprise)."
        ),
        "narrowRationale": (
            "Refresh after Automations create/open + webhook create progress. "
            "Remove SETUP-BENNY-CREATION-BOUNDARY-ENV from live-integrations "
            "blockers. Keep unresolvedReference. Do not set "
            "completeDependencyClosure true. Do not fabricate Slack/Generate/auth."
        ),
        "behavioralExerciseClaim": False,
        "inventorySha256": inv_hash,
        "counts": counts,
        "reasonCounts": reason_counts,
        "attemptIds": ATTEMPT,
        "evidence": [
            "parity/research/dep-live-integrations-002/dispositions.json",
            "parity/research/dep-live-integrations-002/summary.json",
            "parity/briefs/reports/u-dep-live-integrations-002-report.md",
            EVIDENCE["url_editor"],
            EVIDENCE["automate_handoff"],
            EVIDENCE["webhook_create"],
            EVIDENCE["benny_editor_title"],
            EVIDENCE["pi_blocked"],
        ],
        "proposedUnresolvedReferenceText": narrowed,
        "keepOpenBlockers": [
            {
                "id": "BENNY-TRIAGE-VALID-CONFIG-ENV",
                "note": (
                    "Valid Benny+Slack config and one granted test-thread "
                    "reply unpaid."
                ),
            },
            {
                "id": "SETUP-BENNY-THREAD-SAFETY-ENV",
                "note": (
                    "Automations editor Save/Activate + Slack seven-checks "
                    "unpaid."
                ),
            },
            {
                "id": "MAKE-BOT-UI-KEY-SERVER-HOST",
                "note": (
                    "Webhook create witnessed (c345b7ed); Generate auth + "
                    "0600 key store + probe unpaid (console locked)."
                ),
            },
            {
                "id": "third-party-live-installs",
                "note": (
                    "Linear/Notion/GitHub/GitLab/Teams live installs not "
                    "exercised."
                ),
            },
            {
                "id": "cursor-self-hosted-computer-use",
                "note": "CU cloud helper live exercise unpaid (host edge).",
            },
            {
                "id": "cursor-enterprise-integration-policy",
                "note": (
                    "Enterprise Model Providers / Groups policy observation "
                    "unpaid (host edge)."
                ),
            },
        ],
        "closedEnvResolvedNotInBlockers": [
            {
                "id": "SETUP-BENNY-CREATION-BOUNDARY-ENV",
                "status": "closed-env-resolved",
                "note": (
                    "Removed from blockerMismatchIds. Requirement stays "
                    "unverified (Pi f4c7eec5)."
                ),
            }
        ],
        "ledgerEdits": {
            "apply": False,
            "note": (
                "Worker must not edit ledgers. Coordinator applies if accepted."
            ),
            "unresolvedReferences": {
                "action": "replace-matching",
                "matchContains": "Live integrations live-exercise",
                "newText": narrowed,
            },
            "completeDependencyClosure": False,
            "nodeEvidenceAppend": {
                "node": "cursor-cli-host",
                "paths": [
                    "parity/research/dep-live-integrations-002/dispositions.json",
                    "parity/research/dep-live-integrations-002/summary.json",
                ],
            },
        },
    }

    verify = {
        "inventoryPath": (
            "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
        ),
        "expectedSha256": EXPECTED_SHA256,
        "actualSha256": inv_hash,
        "verified": inv_hash == EXPECTED_SHA256,
        "itemCount": len(items),
        "counts": counts,
        "reasonCounts": reason_counts,
        "blockerMismatchIds": blocker_mismatch_ids,
        "canCloseUnresolvedReference": can_close,
        "creationBoundaryAbsentFromBlockers": (
            "SETUP-BENNY-CREATION-BOUNDARY-ENV" not in blocker_mismatch_ids
        ),
        "sumClassesEqualsItemCount": sum(counts.values()) == len(items),
        "reclassificationCount": len(reclass_log),
    }

    (OUT / "dispositions.json").write_text(
        json.dumps(dispositions, indent=2) + "\n"
    )
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (OUT / "merge-proposal.json").write_text(json.dumps(merge, indent=2) + "\n")
    (OUT / "reclassification-log.json").write_text(
        json.dumps(reclass_log, indent=2) + "\n"
    )
    (OUT / "verify.json").write_text(json.dumps(verify, indent=2) + "\n")

    print(
        json.dumps(
            {
                "verified": True,
                "counts": counts,
                "reasonCounts": reason_counts,
                "canClose": can_close,
                "blockers": blocker_mismatch_ids,
                "delta": summary["delta"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
