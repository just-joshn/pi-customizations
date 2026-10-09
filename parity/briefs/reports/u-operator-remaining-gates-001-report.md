# Operator remaining gates (u-operator-remaining-gates-001)

Presence-only grant checklist for every completion blocker after MODE-STICKY closed (94/98 → still BLOCKED at 14 blockers). No secrets. No ledger edits. No freeze claim. No fabricated grants.

throughput checkpoint: n/a, read-only investigation

## Overview

`parity/completion.json` evaluated at `2026-10-09T06:34:09.122Z` is `BLOCKED` with 14 blockers. Sticky Custom Mode is already closed-paired-parity (Agents Window Use as Mode). Grok Pi cap is closed-paired-parity. Desktop share Ready=yes. Pi make-bot half is `key_server_ok`. CU local live is yes without cloud attempt IDs.

Remaining unpaid work is account-owner grants plus coordinator recapture. This unit lists those grants. It does not mark mismatches closed.

**Remaining operator grants: 11** (machine copy at `parity/research/operator-remaining-gates-001/grant-checklist.json`).

## Key concepts

- Operator grant means an account-owner host action agents must not invent (tokens, Slack posts, Automations editor saves, webhook routines, User API Keys, Enterprise policy changes, freeze custody).
- Source-lock incomplete and completeDependencyClosure false clear only after CU edge, enterprise edge, and live-integrations unresolvedReference close. They are not separate grants.
- Requirement and mismatch blockers for the same env cell share one grant path. Close needs linked Cursor+Pi pair evidence after grants, not this checklist alone.

## How it works

### Grant checklist (blocker → measured state → operator action → done predicate → recapture)

| Blocker | Measured state | Exact operator action | Done predicate | Recapture pointer |
| --- | --- | --- | --- | --- |
| SOURCE_LOCK_INCOMPLETE | `source-lock.json` status `incomplete` | No direct grant. Clear G1, G2, and live-integrations (G4–G11) so coordinator can finalize the lock. | `source-lock.json` status finalized per contract §2 | Coordinator re-run of completion after dependency closures |
| SOURCE_CLOSURE_INCOMPLETE | `cursorPlugins.completeDependencyClosure` false; note names CU cloud IDs, enterprise unobserved, live-integrations open | Same as above. Do not flip the flag by hand. | `completeDependencyClosure` true with evidence, not a silent edit | Same |
| DEPENDENCY_REFERENCE_UNRESOLVED | Live-integrations unresolvedReference open; inventory 275 custody / 119 env-bound / 22 evidenced | Pay G4–G11 class grants (Benny/Slack, Automations editor, make-bot webhook, third-party live installs). Do not fabricate Slack posts or editor saves. | unresolvedReference cleared or narrowed only after real grants + evidence; `canClose` stays false until then | `parity/briefs/reports/u-dep-live-integrations-001-report.md`; dispositions under `parity/research/dep-live-integrations-001/` |
| DEPENDENCY_EDGE_UNRESOLVED edges[0] CU | Local Helper MCP live yes (`CU_LIVE_001_177e3351`); desktop share Ready=yes; cloud attempt IDs none; keychain token → API 401 Invalid User API Key | **G1.** Mint User API Key (Dashboard → API Keys) or authorize one dashboard cloud-agent claim against workerId `0400ae0d-aa5c-4949-a4b8-88e40cd9611a` with computer-use screenshot/click. Publish attempt ID + chat screenshot. | Edge may resolve only with live exercise **and** attempt IDs; local Helper alone is not enough | `parity/briefs/reports/u-dep-computer-use-live-001-report.md`; `parity/research/dep-computer-use-exercise-001/merge-payload.json` |
| DEPENDENCY_EDGE_UNRESOLVED edges[1] enterprise | Docs custody only; no live Enterprise policy observation; standing prefs forbid allowlist widening | **G2.** Provide Enterprise team/org with observable Model Providers / Groups settings. Authorize read-only policy observation (MCP precedence + CLI applicability). No worker-initiated allowlist widen unless you explicitly grant it. | Attempt IDs show live policy observation; then coordinator may set edge resolved | `parity/research/dep-host-edges-terminal-001/host/enterprise-disposition.json` |
| ACCEPTANCE_DEFINITIONS_UNFROZEN | Live-98 DRAFT bytes present; digests match; owner null; external custody fail; authorization NONE; freeze-prep decision BLOCKED (5 pass / 3 fail) | **G3.** Name independent owner ≠ implementation parent. Place measured definition+configuration bytes in external immutable custody. Authorize freeze. Do not name this worker or the implementation parent as owner. Default remains parked until `custody`. | `acceptanceDefinitionsFrozen` true only after owner + custody + auth; digests still `e5761017…` / `9eea3685…` unless regen supersedes | `parity/research/acceptance-freeze-prep-002/freeze-prep.json`; `gate-proposal.md` |
| REQUIREMENT + MISMATCH Benny triage (`PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001` / `BENNY-TRIAGE-VALID-CONFIG-ENV`) | Fail-closed pair exists; valid-env probe `runnable: false`; config/token/MCP grants absent | **G4–G8.** Benny YAML at `~/.config/benny/configuration.yaml` (no token literals). Export bot token env. Complete Slack MCP IDE auth. Name test channel. Grant **one** non-customer test-thread reply. Wire harness-resolvable Slack actions. | Probe runnable; linked Cursor+Pi valid-config pair shows thread-only triage, no reproduce-or-fix in triage skill | `parity/research/benny-env-unblock-001/operator-grant-checklist.md` §A + BENNY-TRIAGE; brief `parity/briefs/u-journey-cmd-benny-triage-valid.md`; `node parity/scripts/probe-benny-triage-valid-env.mjs` |
| REQUIREMENT + MISMATCH Make Bot (`PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001` / `MAKE-BOT-UI-KEY-SERVER-HOST`) | Pi `key_server_ok` (`e75f8e08`); Cursor `bb50ed1b` host_blocked (no `update_state` / webhook Routines) | **G10.** Provide a Cursor host path where `update_state` can create a webhook routine and secret-request keeps the sender key server-only. Do not invent a sender key. | Linked Cursor+Pi pair creates page + webhook with key absent from browser, chat, and skill file | Brief `parity/briefs/u-journey-cmd-make-bot.md`; `node parity/scripts/probe-make-bot-ui-host.mjs`; `node parity/scripts/capture-make-bot-ui-key-server.mjs` |
| REQUIREMENT + MISMATCH Benny thread-safety (`PSTACK-SETUP-BENNY-THREAD-SAFETY-001` / `SETUP-BENNY-THREAD-SAFETY-ENV`) | Env probe `runnable: false`; Automations editor absent from PTY | **G4–G9.** Shared Benny/Slack grants plus Automations editor-save witness. Grant seven-check posts on the designated test channel. Do not enable normal Benny traffic until all seven pass. | After witnessed editor save, linked pair shows all seven checks pass | Benny checklist §SETUP-BENNY-THREAD-SAFETY; brief `parity/briefs/u-journey-setup-benny-thread-safety.md`; `node parity/scripts/probe-setup-benny-thread-safety-env.mjs` |
| REQUIREMENT + MISMATCH Benny creation-boundary (`PSTACK-SETUP-BENNY-CREATION-BOUNDARY-ENV` / `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001`) | Both hosts env-blocked; PTY has no `/automate` editor handoff | **G9.** Host that finishes first-time create only through `/automate` → reviewed Automations editor handoff (Desktop Agents Window, cursor.com/automations, or future cursor-agent editor surface). No deep link / direct backend. No enable before thread-safety. | Host probe runnable; linked pair witnesses editor handoff only | Benny checklist §SETUP-BENNY-CREATION-BOUNDARY; brief `parity/briefs/u-journey-setup-benny-creation-boundary.md`; probe + `node parity/scripts/capture-setup-benny-creation-boundary.mjs` |

### Distinct grants (11)

| ID | Grant |
| --- | --- |
| G1 | CU User API Key or dashboard cloud claim → attempt IDs |
| G2 | Enterprise org + read-only policy observation authorization |
| G3 | Acceptance independent owner + external custody + freeze authorization |
| G4 | Benny `configuration.yaml` present (secret-free) |
| G5 | `BENNY_SLACK_BOT_TOKEN` or `SLACK_BOT_TOKEN` in agent-visible env |
| G6 | Slack MCP auth in Cursor desktop IDE (`plugin-slack-slack` not needsAuth) |
| G7 | Designated test channel + owner grants (1 triage reply + 7 thread-safety posts) |
| G8 | Harness-resolvable Slack read/post action wiring |
| G9 | Automations editor `/automate` host path with witnessed save |
| G10 | Cursor make-bot host with `update_state` / webhook routines / secret-request |
| G11 | Third-party live installs (Linear / Notion / GitHub / GitLab / Teams) for live-integrations remainder |

### Recapture order after grants

1. G9 creation-boundary host path (editor available).
2. Thread-safety after witnessed editor save (G4–G8 + G9).
3. Triage valid-config one-reply (G4–G8).
4. Make-bot Cursor half (G10).
5. CU cloud claim (G1) and enterprise observation (G2) as parallel host grants.
6. G11 third-party installs as needed for live-integrations closure.
7. G3 acceptance freeze only when custody is real. This checklist does not freeze.

Do not reverse 1→2. Skill contract requires thread-safety before normal Benny enablement.

## Where things live

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-operator-remaining-gates-001-report.md` |
| Machine checklist | `parity/research/operator-remaining-gates-001/grant-checklist.json` |
| Prior env gates (sticky still listed historically) | `parity/briefs/reports/u-operator-env-gates-001-report.md` |
| Benny grant detail | `parity/research/benny-env-unblock-001/operator-grant-checklist.md` |
| Completion ledger (read-only) | `parity/completion.json` |
| Open mismatches (4) | `BENNY-TRIAGE-VALID-CONFIG-ENV`, `MAKE-BOT-UI-KEY-SERVER-HOST`, `SETUP-BENNY-THREAD-SAFETY-ENV`, `SETUP-BENNY-CREATION-BOUNDARY-ENV` |

## Gotchas

- MODE-STICKY is paid. Do not re-open Custom Modes CLI work for completion.
- Pi make-bot `key_server_ok` does not close the Cursor host cell.
- Local CU live screenshots do not resolve the CU edge without attempt IDs.
- Slack CLI `doctor` Valid plus desktop app running is not Benny bot env or harness `auth.test` ok.
- Acceptance DRAFT bytes are not a freeze. Owner/custody/auth still fail.
- Oracle freeze remains an owner decision. This unit claims none.

## Verify

Cross-check (measured this unit):

```bash
python3 -c "import json; c=json.load(open('parity/completion.json')); print(len(c['blockers']), c['verdict'])"
python3 -c "import json; print([x['id'] for x in json.load(open('parity/mismatches.json'))['items'] if x['status']=='open'])"
python3 -c "import json; print(json.load(open('parity/research/operator-remaining-gates-001/grant-checklist.json'))['remainingOperatorGrantCount'])"
```

Expected. `14 BLOCKED`. Four open mismatch ids as above. Grant count `11`.

## Standing

Did not edit `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, `parity/completion.json`, `parity/dependencies.json`, or `parity/source-lock.json`. Did not commit. Did not spawn further subagents. Did not paste secrets.
