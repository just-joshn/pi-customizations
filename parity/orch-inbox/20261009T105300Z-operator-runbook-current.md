# Operator runbook (current) — 2026-10-09T10:53Z

Score: **95/98** verified-pass-paired. `completion.json` BLOCKED (12). Console **still locked** (`IOConsoleLocked`). Wait-unlock 2h window polling; post-unlock probe auto-runs.

## Do not Restart yet

Say **Restart now** only after unlock census ready and make-bot/Slack desktop captures are not mid-flight.

## Offline already landed (no unlock needed)

- Host `/automate` + Automations editor + creation-boundary **verified-pass-paired**
- setup-benny Pi adapter on `/automate` path
- `AutomationRecordThreadSafety` / `AutomationEnable` (local) / `AutomationDisable`
- Candidate `packageDigest` refreshed; journeys no-workers 541/541; suite green
- Thread-safety probe: `piThreadSafetyLocalToolsPresent=true`
- CU cloud re-probe 002: `CURSOR_API_KEY` still unset

## After unlock (ordered)

| # | Gate | Action |
| --- | --- | --- |
| G10 | Make-bot | Discard Untitled (do not Save) → webhook editor Generate → 0600 key → probe 200. Auto: `post-unlock-002` / `probe-auth-header.py` |
| — | Live-int-003 | `parity/briefs/u-dep-live-integrations-003.md` after make-bot evidence |
| G4–G8 | Slack MCP | Authenticate `plugin-slack-slack` in Cursor **desktop IDE** (agent cannot) |
| G4–G8 | Benny triage | Valid-config + one authorized test-thread reply |
| — | Thread-safety | Editor save witness + seven live Slack checks → RecordThreadSafety → Enable |
| G1 | CU cloud | Export User API Key as `CURSOR_API_KEY`; list-only probe; spend grant before create |
| G2 | Enterprise | Org/team observation authorization |
| G3 | Freeze | Independent owner + external custody + authorization |

## Open mismatches (3)

`BENNY-TRIAGE-VALID-CONFIG-ENV`, `MAKE-BOT-UI-KEY-SERVER-HOST`, `SETUP-BENNY-THREAD-SAFETY-ENV`
