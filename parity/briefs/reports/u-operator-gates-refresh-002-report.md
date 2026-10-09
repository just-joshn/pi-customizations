# Operator gates refresh (u-operator-gates-refresh-002)

Presence-only grant checklist against current ledgers. No secrets. No ledger edits. No freeze claim. No fabricated grants.

throughput checkpoint: n/a, read-only investigation

## Overview

`parity/completion.json` evaluated at `2026-10-09T08:43:42.654Z` is `BLOCKED` with **13** blockers (was 14 in u-operator-remaining-gates-001). Verified-pass-paired is **94/98**. Open mismatches are **3**. Live-integrations-002 classes are a=275 / **b=115** / c=26. Host console measures `IOConsoleLocked=Yes`. Creation-boundary ENV is `closed-env-resolved`; freeze-prep recommendation is **Option A keep-unverified**. Custody pack remains operator handoff only.

**Remaining operator grants: 11** (machine copy at `parity/research/operator-gates-refresh-002/grant-checklist.json`).

## Key concepts

- Operator grant means an account-owner host action agents must not invent.
- `SETUP-BENNY-CREATION-BOUNDARY-ENV` closed does not close `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001`. Cursor half is paid. Pi half (`f4c7eec5`) stays unpaid under Option A.
- Make-bot webhook create (`c345b7ed`) is paid. Generate auth is unpaid while the console is locked.
- Source-lock incomplete and `completeDependencyClosure` false clear only after CU edge, enterprise edge, and live-integrations unresolvedReference close.

## How it works

### Grant checklist (G1–G11)

| ID | Measured state | Exact operator action | Done predicate | Unblocks |
| --- | --- | --- | --- | --- |
| G1 | CU local Helper live; cloud attempt IDs none; keychain API 401 | Mint User API Key or one dashboard cloud-agent claim with screenshot/click; publish attempt ID | Live exercise **and** attempt IDs present | `DEPENDENCY_EDGE_UNRESOLVED` edges[0]; helps source lock/closure |
| G2 | Enterprise docs custody only | Enterprise org + read-only policy observation auth. No allowlist widen | Attempt IDs show live policy observation | edges[1]; helps source lock/closure |
| G3 | `acceptanceDefinitionsFrozen` false; owner null; custody pack ready | Independent owner ≠ implementation parent + external custody + freeze auth. Creation-boundary stays Option A unless owner grants Option B separately | `acceptanceDefinitionsFrozen` true | `ACCEPTANCE_DEFINITIONS_UNFROZEN` only |
| G4 | `~/.config/benny/configuration.yaml` absent | Create secret-free Benny YAML (env names only) | `CONFIG_PRESENT` | Triage + thread-safety req/mismatch; live-int Slack class b |
| G5 | Bot token env absent | Export `BENNY_SLACK_BOT_TOKEN` or `SLACK_BOT_TOKEN` | `TOKEN_ENV_PRESENT`; `slack api auth.test` ok | Same as G4 |
| G6 | `plugin-slack-slack` needsAuth | Complete Slack MCP IDE auth | Tools not needsAuth | Same as G4 |
| G7 | No designated test channel / post grants | Name test channel; grant 1 triage reply + 7 thread-safety posts | Owner grant recorded; posts allowed for harness | Same as G4 |
| G8 | Slack action names placeholders | Wire harness-resolvable Slack actions in YAML | Probe fields become true after harness update | Same as G4 |
| G9 | Cursor create/open paid (`f6e29fb7`, `b60a705b`, `e11d7225`, `475ab346`, `2c525e93`); Save/Activate unpaid; Pi editor absent (`f4c7eec5`) | Witness Automations **Save** for thread-safety (do not Activate/enable before seven-checks). Pi Automations editor still required for creation-boundary pair under Option A | Save witnessed; Pi editor exists before creation-boundary verified-pass-paired | Thread-safety req/mismatch; creation-boundary **requirement** (not ENV); live-int save rows |
| G10 | Webhook create `c345b7ed`; auth reentry `2bcf48b9` blocked; Pi `e75f8e08` key_server_ok; `IOConsoleLocked=Yes` | **Unlock → Discard Untitled → Generate** (see path below) | Generate + 0600 store + probe 200; linked Cursor+Pi pair | Make-bot req + `MAKE-BOT-UI-KEY-SERVER-HOST`; webhook Generate class b |
| G11 | 39 third-party live-install class-b rows | Live-install Linear / Notion / GitHub / GitLab / Teams as needed | Live exercise evidence | unresolvedReference; helps source lock/closure |

### G10 explicit path (unlock → Discard Untitled → Generate)

1. Unlock the Mac lock screen (password / Touch ID) until desktop responds to mouse.
2. Confirm `ioreg -n Root -d1 | grep IOConsoleLocked` prints `No`.
3. Restart the Cursor agent terminal attached to this repo.
4. In Automations, **Discard** the stuck Untitled draft. Do not Save.
5. Open the webhook draft. Click **Generate auth header**, or leave the editor open and tell the coordinator.
6. Coordinator recaptures Generate + 0600 key store + probe HTTP 200 against Pi `e75f8e08-0d8c-4d55-ad3f-6946c405bbaf`.

### Creation-boundary (Option A)

| Host | State | Attempt IDs |
| --- | --- | --- |
| Cursor | Paid list + editor title | `e11d7225`, `475ab346`, `2c525e93` |
| Pi | env-blocked; no Automations editor | `f4c7eec5` |
| ENV mismatch | `closed-env-resolved` | — |
| Requirement | `unverified` (still a completion blocker) | — |
| Freeze-prep | Option A keep-unverified (proposal only) | report `u-acceptance-creation-boundary-freeze-prep-001` |

Do not freeze from this unit. Do not enable Inactive `benny-triage` before thread-safety.

### Recapture order after grants

1. G10 unlock → Discard → Generate (console is the hard stop now).
2. G4–G8 Benny/Slack shared grants.
3. G9 Save witness, then G7 seven-check posts (thread-safety before enable).
4. G1 and G2 as parallel host grants.
5. G11 third-party installs as needed for live-integrations.
6. G3 acceptance freeze only with real custody. Creation-boundary stays Option A unless owner grants Option B.

## Where things live

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-operator-gates-refresh-002-report.md` |
| Machine checklist | `parity/research/operator-gates-refresh-002/grant-checklist.json` |
| Verify lever | `parity/research/operator-gates-refresh-002/verify-against-ledgers.mjs` |
| Prior gates | `parity/briefs/reports/u-operator-remaining-gates-001-report.md` |
| Live-int 002 | `parity/briefs/reports/u-dep-live-integrations-002-report.md` |
| Creation-boundary Option A | `parity/briefs/reports/u-acceptance-creation-boundary-freeze-prep-001-report.md` |
| Unlock inbox | `parity/orch-inbox/20261009T084500Z-unlock-then-make-bot.md` |

## Gotchas

- MODE-STICKY and Grok cap stay closed. Do not reopen them as unpaid grants.
- Creation-boundary ENV close is not requirement close.
- Local CU screenshots without cloud attempt IDs do not resolve edges[0].
- Slack CLI `doctor` Valid is not Benny bot env.
- This unit does not freeze anything.

## Top 3 operator actions (by unblock impact)

1. **G10.** Unlock console → Discard Untitled → Generate. Clears make-bot requirement + mismatch on the only path with paid webhook create and a waiting Pi half.
2. **G4–G8.** Benny config + token env + Slack MCP + test channel + harness actions. Shared foundation for triage and thread-safety (four completion blockers) and ~44 live-int Slack rows.
3. **G9 remaining.** Witness Automations Save (then seven-check posts). Unblocks thread-safety after G4–G8. Keep creation-boundary on Option A.

## Verify

```bash
node parity/research/operator-gates-refresh-002/verify-against-ledgers.mjs
python3 -c "import json; c=json.load(open('parity/completion.json')); print(len(c['blockers']), c['verdict'])"
python3 -c "import json; print([x['id'] for x in json.load(open('parity/mismatches.json'))['items'] if x['status']=='open'])"
ioreg -n Root -d1 | grep IOConsoleLocked
```

Expected. `13 BLOCKED`. Open ids `BENNY-TRIAGE-VALID-CONFIG-ENV`, `MAKE-BOT-UI-KEY-SERVER-HOST`, `SETUP-BENNY-THREAD-SAFETY-ENV`. Console `Yes` until operator unlocks. Verify script `ok: true`.

## Standing

Did not edit `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, `parity/completion.json`, `parity/dependencies.json`, or `parity/source-lock.json`. Did not freeze. Did not spawn further subagents. Did not paste secrets.
