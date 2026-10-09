#!/usr/bin/env python3
"""Classify wave-007 live-integrations inventory items (a/b/c). Rerunnable lever."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INVENTORY = ROOT / "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
EXPECTED_SHA256 = (
    "63ef7f8f4c35e3918556e787f22eb308666e5e8d0b444b41584524ce13b867d4"
)
OUT = Path(__file__).resolve().parent

# First matching rule wins. Order: evidenced (c), environment-bound (b), else (a).
# Patterns match against "id url ownedBehavior path status" lowercased.
RULES: list[dict] = [
    # (c) Model/pricing budget already paired (setup-grok-xhigh-cap).
    {
        "class": "c_already_evidenced",
        "reason": "models_pricing_paired_via_setup_grok_xhigh_cap",
        "patterns": [
            r"docs_models-and-pricing",
            r"models-and-pricing\.md",
            r"cursor\.services\.docs_models",
        ],
        "evidence": [
            "parity/evidence/setup-grok-xhigh-cap/pair-setup-grok-xhigh-cap-1.json",
            "parity/requirements.json#PSTACK-SETUP-GROK-XHIGH-CAP-001",
        ],
    },
    # (c) Automate-me existing-skill path is paired; maps only to automate-me
    # personal -mode skill, not Cloud Automations editor. No inventory id uses
    # "automate-me", so this rule is a no-op unless ids appear later.
    {
        "class": "c_already_evidenced",
        "reason": "automate_me_existing_skill_paired",
        "patterns": [r"automate-me", r"automate_me"],
        "evidence": [
            "parity/evidence/automate-me/pair-automate-me-existing-skill-1.json",
            "parity/requirements.json#PSTACK-CMD-AUTOMATE-ME-EXISTING-SKILL-001",
        ],
    },
    # (c) Benny incomplete-config / no-automate / no-secret / not-slash pairs.
    # Inventory is Cursor host docs; only match explicit benny skill markers.
    {
        "class": "c_already_evidenced",
        "reason": "benny_skill_negative_path_paired",
        "patterns": [
            r"\bbenny\b",
            r"setup-benny",
            r"triage-issue-reports",
            r"reproduce-and-fix",
        ],
        "evidence": [
            "parity/evidence/benny-repro/pair-benny-repro-fail-closed-1.json",
            "parity/evidence/benny-triage/pair-benny-triage-fail-closed-1.json",
            "parity/evidence/setup-benny/pair-setup-benny-not-slash-1.json",
            "parity/evidence/setup-benny/pair-setup-benny-no-secret-1.json",
            "parity/evidence/setup-benny/pair-setup-benny-existing-no-automate-1.json",
        ],
    },
    # (b) Live Slack surfaces needing operator grant (open Benny/Slack mismatches).
    {
        "class": "b_environment_bound",
        "reason": "live_slack_needs_operator_grant",
        "patterns": [
            r"integrations_slack",
            r"integrations/slack",
            r"send-to-slack",
            r"read-slack",
            r"slack-triggers",
            r"slack triggers",
            r"how-do-slack-triggers",
            r"microsoft-teams",
        ],
        "evidence": [
            "parity/mismatches.json#BENNY-TRIAGE-VALID-CONFIG-ENV",
            "parity/mismatches.json#SETUP-BENNY-THREAD-SAFETY-ENV",
            "parity/evidence/benny-triage/blocker-benny-triage-valid-1.json",
            "parity/evidence/setup-benny/blocker-setup-benny-thread-safety-1.json",
        ],
        "blockerMismatchIds": [
            "BENNY-TRIAGE-VALID-CONFIG-ENV",
            "SETUP-BENNY-THREAD-SAFETY-ENV",
        ],
    },
    # (b) Automations editor create/save (not doc custody alone).
    {
        "class": "b_environment_bound",
        "reason": "automations_editor_runtime_needs_operator_grant",
        "patterns": [
            r"help_ai-features_automations\.how-do-i-create",
            r"help/ai-features/automations",
            r"docs_cloud-agent_automations\.automations$",
            r"docs_cloud-agent_automations\.getting-started",
            r"cloud-agent/automations\.md",
            r"how-do-i-create-an-automation",
            r"how do i create an automation",
        ],
        "evidence": [
            "parity/mismatches.json#SETUP-BENNY-CREATION-BOUNDARY-ENV",
            "parity/mismatches.json#SETUP-BENNY-THREAD-SAFETY-ENV",
            "parity/evidence/setup-benny/blocker-setup-benny-creation-boundary-1.json",
            "parity/evidence/setup-benny/pair-setup-benny-creation-boundary-1.json",
        ],
        "blockerMismatchIds": [
            "SETUP-BENNY-CREATION-BOUNDARY-ENV",
            "SETUP-BENNY-THREAD-SAFETY-ENV",
        ],
    },
    # (b) Webhook routines / secret store live paths (make-bot + grok routines).
    {
        "class": "b_environment_bound",
        "reason": "webhook_routine_or_secret_live_needs_operator_grant",
        "patterns": [
            r"docs_cloud-agent_api_webhooks",
            r"cloud-agent/api/webhooks",
            r"help_grok-bot_routines",
            r"help/grok-bot/routines",
            r"help_grok-bot_secrets",
            r"help/grok-bot/secrets",
            r"grok-bot/work\.md#skills-and-routines",
            r"webhook-triggers",
            r"webhook url and key",
            r"make-bot",
            r"make_bot",
        ],
        "evidence": [
            "parity/mismatches.json#MAKE-BOT-UI-KEY-SERVER-HOST",
            "parity/evidence/make-bot-ui/pair-make-bot-ui-key-server-1.json",
            "parity/evidence/make-bot-ui/blocker-make-bot-ui-key-server-1.json",
        ],
        "blockerMismatchIds": ["MAKE-BOT-UI-KEY-SERVER-HOST"],
    },
    # (b) Other third-party live installs named in inventory (no fabricated posts).
    {
        "class": "b_environment_bound",
        "reason": "third_party_live_install_needs_operator_grant",
        "patterns": [
            r"integrations_linear",
            r"integrations/linear",
            r"integrations_notion",
            r"integrations/notion",
            r"integrations/github",
            r"integrations/gitlab",
            r"linear-triggers",
        ],
        "evidence": [
            "parity/research/dep-closure-wave-007/live/integrations-inventory.json",
            "parity/research/dep-closure-wave-007/nodes/live-integrations.md",
        ],
        "blockerMismatchIds": [],
    },
]


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def blob_for(item: dict) -> str:
    parts = [
        item.get("id"),
        item.get("url"),
        item.get("ownedBehavior"),
        item.get("path"),
        item.get("status"),
        item.get("note"),
    ]
    return " ".join("" if p is None else str(p) for p in parts).lower()


def classify(item: dict, index: int) -> dict:
    blob = blob_for(item)
    retrieval_path = item.get("path")
    retrieval_exists = bool(
        retrieval_path and (ROOT / retrieval_path).is_file()
    )
    for rule in RULES:
        for pat in rule["patterns"]:
            if re.search(pat, blob, re.I):
                return {
                    "index": index,
                    "id": item.get("id"),
                    "source": item.get("source"),
                    "class": rule["class"],
                    "reason": rule["reason"],
                    "matchedPattern": pat,
                    "evidence": list(rule["evidence"]),
                    "blockerMismatchIds": list(rule.get("blockerMismatchIds") or []),
                    "retrievalPath": retrieval_path,
                    "retrievalExists": retrieval_exists,
                    "inventoryStatus": item.get("status"),
                    "ownedBehavior": item.get("ownedBehavior"),
                    "url": item.get("url"),
                }
    # Default (a): inventory/doc/proposal custody without live exercise claim.
    evidence = [
        "parity/research/dep-closure-wave-007/live/integrations-inventory.json",
    ]
    if retrieval_exists:
        evidence.append(str(retrieval_path))
    return {
        "index": index,
        "id": item.get("id"),
        "source": item.get("source"),
        "class": "a_custody_complete",
        "reason": "inventory_or_doc_custody_without_live_exercise",
        "matchedPattern": None,
        "evidence": evidence,
        "blockerMismatchIds": [],
        "retrievalPath": retrieval_path,
        "retrievalExists": retrieval_exists,
        "inventoryStatus": item.get("status"),
        "ownedBehavior": item.get("ownedBehavior"),
        "url": item.get("url"),
    }


def main() -> None:
    inv_hash = sha256_file(INVENTORY)
    if inv_hash != EXPECTED_SHA256:
        raise SystemExit(
            f"inventory sha256 mismatch: got {inv_hash}, expected {EXPECTED_SHA256}"
        )

    inventory = json.loads(INVENTORY.read_text())
    items = inventory["items"]
    if len(items) != inventory.get("itemCount", len(items)):
        raise SystemExit("itemCount does not match items length")

    rows = [classify(item, i) for i, item in enumerate(items)]
    counts = {
        "a_custody_complete": 0,
        "b_environment_bound": 0,
        "c_already_evidenced": 0,
    }
    reason_counts: dict[str, int] = {}
    for row in rows:
        counts[row["class"]] += 1
        reason_counts[row["reason"]] = reason_counts.get(row["reason"], 0) + 1

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    can_close = counts["b_environment_bound"] == 0
    can_narrow = True  # always: replace vague open line with classed blockers

    blocker_mismatch_ids = sorted(
        {
            mid
            for row in rows
            if row["class"] == "b_environment_bound"
            for mid in row["blockerMismatchIds"]
        }
    )

    narrowed_reference = (
        "Live integrations live-exercise remains open after u-dep-live-integrations-001 "
        f"disposition at parity/research/dep-live-integrations-001/dispositions.json "
        f"(inventory sha256 {EXPECTED_SHA256}; "
        f"a_custody_complete={counts['a_custody_complete']}, "
        f"b_environment_bound={counts['b_environment_bound']}, "
        f"c_already_evidenced={counts['c_already_evidenced']}). "
        "Operator-grant blockers: Benny/Slack valid-config + thread-safety, "
        "Automations editor create/save, make-bot/webhook routines+secrets, "
        "and third-party live installs (Linear/Notion/GitHub/GitLab/Teams). "
        "No fabricated Slack posts, Automations editor saves, or webhook routines."
    )

    dispositions = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-001",
        "createdAt": now,
        "inventoryPath": "parity/research/dep-closure-wave-007/live/integrations-inventory.json",
        "inventorySha256": inv_hash,
        "inventorySha256Verified": True,
        "liveExerciseStatus": inventory.get("liveExerciseStatus"),
        "itemCount": len(rows),
        "counts": counts,
        "reasonCounts": reason_counts,
        "behavioralExerciseClaim": False,
        "fabricatedLiveEvidence": False,
        "canCloseUnresolvedReference": can_close,
        "canNarrowUnresolvedReference": can_narrow,
        "blockerMismatchIds": blocker_mismatch_ids,
        "classLegend": {
            "a_custody_complete": "custody-complete without live exercise",
            "b_environment_bound": "environment-bound needing operator grant",
            "c_already_evidenced": "already evidenced by an existing parity pair",
        },
        "items": rows,
    }

    summary = {
        "unit": "u-dep-live-integrations-001",
        "createdAt": now,
        "inventorySha256": inv_hash,
        "counts": counts,
        "reasonCounts": reason_counts,
        "canCloseUnresolvedReference": can_close,
        "canNarrowUnresolvedReference": can_narrow,
        "blockerMismatchIds": blocker_mismatch_ids,
        "behavioralExerciseClaim": False,
        "narrowedReferenceText": narrowed_reference,
    }

    merge = {
        "schemaVersion": 1,
        "unit": "u-dep-live-integrations-001",
        "status": "proposal",
        "createdAt": now,
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
            "progressMd": "parity/progress.md",
        },
        "canCloseLiveIntegrationsUnresolvedReference": can_close,
        "canNarrowLiveIntegrationsUnresolvedReference": can_narrow,
        "closeRationale": (
            "Cannot close: environment-bound live surfaces remain unpaid."
            if not can_close
            else "All inventoried items custody-complete or already evidenced."
        ),
        "narrowRationale": (
            "Honest per-item split published. Most inventory rows are doc/proposal "
            "custody without a live-exercise claim. Keep the unresolvedReference but "
            "replace the vague 416-item open line with the narrowed text and attach "
            "dispositions.json. Do not set completeDependencyClosure true. "
            "Do not fabricate Slack/Automations/webhook live evidence."
        ),
        "behavioralExerciseClaim": False,
        "inventorySha256": inv_hash,
        "counts": counts,
        "evidence": [
            "parity/research/dep-live-integrations-001/dispositions.json",
            "parity/research/dep-live-integrations-001/summary.json",
            "parity/briefs/reports/u-dep-live-integrations-001-report.md",
        ],
        "proposedUnresolvedReferenceText": narrowed_reference,
        "keepOpenBlockers": [
            {
                "id": "BENNY-TRIAGE-VALID-CONFIG-ENV",
                "note": "Valid Benny+Slack config and one granted test-thread reply unpaid.",
            },
            {
                "id": "SETUP-BENNY-THREAD-SAFETY-ENV",
                "note": "Automations editor save + Slack seven-checks unpaid.",
            },
            {
                "id": "SETUP-BENNY-CREATION-BOUNDARY-ENV",
                "note": "/automate Automations editor handoff unpaid.",
            },
            {
                "id": "MAKE-BOT-UI-KEY-SERVER-HOST",
                "note": "Webhook routine create + secret-request path unpaid on Cursor host.",
            },
            {
                "id": "third-party-live-installs",
                "note": "Linear/Notion/GitHub/GitLab/Teams live installs not exercised.",
            },
        ],
        "ledgerEdits": {
            "apply": False,
            "note": "Worker must not edit ledgers. Coordinator applies if accepted.",
            "unresolvedReferences": {
                "action": "replace-matching",
                "matchContains": "integrations-inventory.json",
                "newText": narrowed_reference,
            },
            "completeDependencyClosure": False,
            "nodeEvidenceAppend": {
                "node": "cursor-cli-host",
                "paths": [
                    "parity/research/dep-live-integrations-001/dispositions.json",
                    "parity/research/dep-live-integrations-001/summary.json",
                ],
            },
        },
    }

    (OUT / "dispositions.json").write_text(json.dumps(dispositions, indent=2) + "\n")
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (OUT / "merge-proposal.json").write_text(json.dumps(merge, indent=2) + "\n")

    verify = {
        "inventoryPath": str(INVENTORY.relative_to(ROOT)),
        "expectedSha256": EXPECTED_SHA256,
        "actualSha256": inv_hash,
        "verified": inv_hash == EXPECTED_SHA256,
        "itemCount": len(rows),
        "counts": counts,
    }
    (OUT / "verify-inventory-sha256.json").write_text(
        json.dumps(verify, indent=2) + "\n"
    )

    print(json.dumps({"verified": True, "counts": counts, "canClose": can_close}, indent=2))


if __name__ == "__main__":
    main()
