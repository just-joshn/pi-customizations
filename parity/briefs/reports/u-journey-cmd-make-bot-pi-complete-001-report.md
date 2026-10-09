# u-journey-cmd-make-bot-pi-complete-001 report

## Status

Pi half of `PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001` advanced past the prior incomplete stop. New Pi attempt completed RoutinePrepare, operator-terminal secret init, RoutineEnable (reviewed Yes), and a harmless probe. Cursor remains `host_blocked`. Mismatch cannot close. Ledgers untouched. No commit. No secrets in this report.

## Attempt IDs

| Side | Attempt ID | Status |
| --- | --- | --- |
| cursor | `bb50ed1b-29ac-4961-bb0a-5c2ffd9834b2` (reaffirmed) | host_blocked |
| pi (prior) | `8721faf4-89e1-4bc5-8abd-105870b4923d` | incomplete |
| pi (this unit) | `e75f8e08-0d8c-4d55-ad3f-6946c405bbaf` | key_server_ok (manual rescore) |

Pair path. `parity/evidence/make-bot-ui/pair-make-bot-ui-key-server-1.json` (`pairedVerdict` `env_blocker`, `requirementVerified` false)

Blocker path. `parity/evidence/make-bot-ui/blocker-make-bot-ui-key-server-1.json`

## Done markers

- Pi fixture-out. `STATUS=key-server-ok reason=probe HTTP 200 via server relay, ignored in routine transcript; key stayed server-side`
- Operator secret init meta. `ok=true hidden=true exposed=false secretReady=true` (no key value stored)
- Cursor. Prior `STATUS=host-blocked reason=missing update_state/RoutinePrepare` still stands; `cursor-agent --help` and host probe still show no webhook APIs

## Pi progress (measured)

1. `RoutinePrepare` for routine `c2d101c6-5fc9-4386-b581-b75f63c7a859`
2. Capture lever ran `routine-secret.mjs` in a child PTY (echo off). Key never logged. Scrubbed after capture.
3. Follow-up nudged enable+probe without pasting a key
4. `RoutineEnable` with one Yes confirm press
5. Generated `server.mjs` uses `relayEvent(ROUTINE_DIR, …)`; browser posts only declared fields
6. Done marker reports probe HTTP 200

## Key-server boundary?

| Check | Result |
| --- | --- |
| key in chat | false |
| key in tool-arg values | false (manual; automated tripped on phrase `sender-key initializer`) |
| key in browser artifacts | false (`browserLeakFiles` empty) |
| key in skill/evidence body | false (leak scan clean on published artifacts) |
| intended path | operator initializer + server `ROUTINE_DIR` only |

## Cursor

Reaffirmed `host_blocked`. No `update_state` / webhook routine path on cursor-agent in this harness. Did not invent webhook success.

## Merge recommendation

**No.** Do not close the mismatch. Pi can complete the key-server journey. Cursor still lacks the host APIs the skill assumes. Keep the requirement unverified until a real Cursor path exists and is recaptured.

## Commands run

1. Extended `parity/scripts/capture-make-bot-ui-key-server.mjs` with `--pi-complete`
2. `--self-test` green
3. `--pi-complete` → attempt `e75f8e08`
4. Manual rescore for scorer false positives; host probe + `cursor-agent --help` reaffirm
5. Updated pair, blocker, this report

## Deviations

1. Automated outcome first said `key_leaked` from the phrase `sender-key initializer` in a bash STATUS draft. Scorer tightened; manual rescore is `key_server_ok`.
2. Skill/prompt chrome still lights `pty.hostBlocked` via `update_state` wording. Done-marker STATUS now wins in the scorer.
3. Cross-model show-me-your-work Attention review skipped. Unit forbids further subagents.
4. No ledger edits. No commit.

## Decision trail

`parity/research/make-bot-pi-complete-001/decisions.tsv` and `parity/evidence/make-bot-ui/.audit/make-bot-ui-key-server.tsv`
