# Offline gap hunt 001

**Verdict.** No honest offline lever remains that can move `completion.json` toward PASS. Every open completion blocker needs an operator grant outside this hunt's allowed set (Mac unlock, Slack MCP auth, `CURSOR_API_KEY`, Enterprise org, acceptance freeze owner). Console still locked. Wait-unlock left running (node 2578).

throughput checkpoint: n/a, read-only investigation

## Overview

Parity sits at 95/98 verified-pass-paired with completion `BLOCKED` and 12 blockers. The last Pi-native product work for creation-boundary and local thread-safety receipt/Enable/Disable already landed. What remains is live environment and custody work, not more offline package code.

## Key concepts

**Offline lever.** A change under `parity/` research/scripts or `extensions/pi-pstack/` that, without Mac unlock / Slack MCP / CU API key / Enterprise / freeze owner, would remove or satisfy a `completion.json` blocker.

**Operator grant.** An action only the account owner can take (unlock, auth, spend, org, freeze). Named G1–G11 in `parity/research/operator-gates-refresh-002/grant-checklist.json`.

**Environment-bound mismatch.** Open row whose `nextAction` requires live wiring, not a product patch.

## How it works

`check-completion` fails while any of these hold. Source lock incomplete. Dependency closure false. Live-int unresolved reference. Two host edges unresolved. Acceptance unfrozen. Three requirements unverified. Three matching mismatches open.

Mapping measured this hunt (same as accuracy-002).

| Blocker family | Count | Cleared only by |
| --- | --- | --- |
| SOURCE_LOCK / SOURCE_CLOSURE | 2 | Closure after G10+G4–G8+G1+G2, then G3 |
| DEPENDENCY_REFERENCE_UNRESOLVED | 1 | Post-Generate live-int reclass + Slack/third-party live (G10 then G4–G8, G11) |
| DEPENDENCY_EDGE_UNRESOLVED | 2 | G1 CU cloud, G2 Enterprise |
| ACCEPTANCE_DEFINITIONS_UNFROZEN | 1 | G3 independent freeze owner |
| REQUIREMENT_UNVERIFIED + BEHAVIOR_MISMATCH | 6 | Same three cells. G10 make-bot, G4–G8 Benny triage + thread-safety (+G9 Save) |

Pi design gap list in `parity/research/pi-automate-handoff-design-001/design.md` has items 1–3, 5, 6 closed. Remaining gap 4 is Slack ingress. That is G4–G8, not an offline scaffold.

## Ranked offline levers

**None that move completion.**

Candidates examined and rejected.

1. More Pi `/automate` or Enable/Disable code. Creation-boundary already verified-pass-paired. Local receipt tools already present. Does not close the three open mismatches.
2. live-int note refresh or disposition reclass without new Generate/Slack evidence. Would fabricate. `canCloseUnresolvedReference` is already false at b=115.
3. Running live-int-004 now. Brief is staged for after Generate. Generate is unpaid under console lock.
4. Source-lock hashing or package-digest remeasure. Digest already recorded. Does not flip `status=incomplete` or `completeDependencyClosure`.
5. Closing mismatches by text edit. Forbidden (ledgers) and dishonest without paired evidence.

**Prep already armed (does not reduce blocker count until unlock).**

| Artifact | Path | Acceptance check after unlock |
| --- | --- | --- |
| Wait-unlock + probe + merge + live-int hook | `parity/scripts/wait-unlock-then-make-bot-auth.mjs` (running) | `IOConsoleLocked=No` then probe exit 0 |
| Fail-closed make-bot merge | `parity/scripts/merge-make-bot-post-unlock.mjs` | Dry-run refuses without disposition. Real run closes `MAKE-BOT-UI-KEY-SERVER-HOST` only on honest `key_server_ok` |
| live-int-004 brief | `parity/briefs/u-dep-live-integrations-004.md` | Reclass 9 webhook Generate rows only with attempt IDs. `canCloseUnresolvedReference` true only if b=0 |

## Blocked only by operator grants

### G10 (Mac unlock → Discard Untitled → Generate)

- `MAKE-BOT-UI-KEY-SERVER-HOST`
- `PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001`
- Webhook Generate class-b live-int rows (feeds dependency reference)

Pi half already `key_server_ok` (`e75f8e08`). Cursor Generate unpaid. Console `IOConsoleLocked=Yes` measured live.

### G4–G8 (Benny config, bot token env, Slack MCP IDE auth, test-channel grants, harness-resolvable actions)

- `BENNY-TRIAGE-VALID-CONFIG-ENV` / `PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001`
- `SETUP-BENNY-THREAD-SAFETY-ENV` / `PSTACK-SETUP-BENNY-THREAD-SAFETY-001`
- ~44 live-slack class-b rows

Plus **G9** Automations editor Save witness for thread-safety (desktop path. Still operator. Not offline).

### G1 (`CURSOR_API_KEY` / cloud CU attempt IDs)

- `dependencies.json` edge `cursor-cli-host` → `cursor-self-hosted-computer-use`
- Contributes to source closure / source lock

### G2 (Enterprise org observation)

- Edge `cursor-cli-host` → `cursor-enterprise-integration-policy`
- observe-002 still Pro+ / no-team

### G3 (acceptance freeze owner)

- `ACCEPTANCE_DEFINITIONS_UNFROZEN`
- Custody pack digests exist. Owner / external custody / authorization unpaid. Prefs forbid implementation owner freezing unilaterally.

### Also operator-only (not in the user's exclusion list but not offline)

- **G11** third-party live installs (~39 class-b rows). Needed before `completeDependencyClosure` can go true even after G10/G4–G8.

## Where things live

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-offline-gap-hunt-001-report.md` |
| Census JSON | `parity/research/offline-gap-hunt-001/census.json` |
| Check list | `parity/research/offline-gap-hunt-001/checked.md` |
| Prior accuracy audit | `parity/research/completion-blocker-accuracy-002/audit.json` |
| Live-int counts | `parity/research/dep-live-integrations-003/summary.json` |
| Grant checklist | `parity/research/operator-gates-refresh-002/grant-checklist.json` |
| Pi gap list | `parity/research/pi-automate-handoff-design-001/design.md` |
| Completion gate | `parity/completion.json` |

## Gotchas

- Note-only refreshes do not clear `DEPENDENCY_REFERENCE_UNRESOLVED`.
- Local `AutomationEnable` is not Slack seven-checks. Do not verify thread-safety from tool presence alone.
- Do not kill wait-unlock for a terminal restart while console is locked.
- This unit did not edit `mismatches.json`, `requirements.json`, or `progress.md`.

## Proof that no offline lever remains

Checked.

1. All 12 completion blockers (census).
2. Exactly 3 open mismatches, all `environment-bound`.
3. Exactly 3 unverified requirements (same trio).
4. Exactly 2 unresolved dependency edges (G1, G2).
5. live-int `canCloseUnresolvedReference=false` at b=115.
6. Pi automate design gaps 1–3, 5, 6 closed. Gap 4 = Slack ingress.
7. Post-unlock cascade already staged. Nothing left to scaffold offline that removes a blocker.
8. Live console lock + wait-unlock liveness confirmed. No invented Slack/Generate/CU evidence.

## Non-claims

Does not edit ledgers. Does not freeze. Does not claim unlock. Does not authorize Restart guidance.
