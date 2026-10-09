# Offline gap hunt 001. What was checked

Measured at hunt time with console `IOConsoleLocked=Yes` and wait-unlock node PID 2578 alive. No ledger edits. No Slack/Generate/CU evidence invented.

## Completion gate

- `parity/completion.json` verdict `BLOCKED`, 12 blockers, package digest present, `acceptanceDefinitionHashes.frozen=false`.
- Cross-check `parity/research/completion-blocker-accuracy-002/audit.json` (12/12 still valid, 0 stale false-opens).

## Open behavioral work

- `parity/mismatches.json` open ids only: `BENNY-TRIAGE-VALID-CONFIG-ENV`, `MAKE-BOT-UI-KEY-SERVER-HOST`, `SETUP-BENNY-THREAD-SAFETY-ENV` (all `environment-bound`).
- `parity/requirements.json` non-`verified-pass-paired` ids only the same three requirements.

## Dependency closure

- `parity/dependencies.json` unresolved edges = 2 (CU cloud, enterprise).
- `unresolvedReferences` length = 1 (live-int-003 text). `canCloseUnresolvedReference=false` in `parity/research/dep-live-integrations-003/summary.json` (a=275 / b=115 / c=26).
- `parity/source-lock.json` `status=incomplete`, `completeDependencyClosure=false`.

## Pi product gaps vs live unpaid

- `parity/research/pi-automate-handoff-design-001/design.md` gap list. Items 1–3, 5, 6 struck done. Remaining product gap 4 is Slack ingress runtime. Live seven-checks still unpaid.
- Creation-boundary already `verified-pass-paired`. Thread-safety local tools already present per source-lock note.

## Armed post-unlock cascade (not offline closers)

- Wait-unlock script running (`parity/scripts/wait-unlock-then-make-bot-auth.mjs`, node 2578).
- Fail-closed merge staged (`parity/scripts/merge-make-bot-post-unlock.mjs`).
- live-int-004 brief staged (`parity/briefs/u-dep-live-integrations-004.md`) for after Generate.

## Operator grant map

- `parity/research/operator-gates-refresh-002/grant-checklist.json` and current orch inbox runbooks. All 12 completion blockers map to G10 / G4–G8 (+G9 Save) / G11 / G1 / G2 / G3.

## Host lock

- Live `ioreg` shows `IOConsoleLocked=Yes` and `CGSSessionScreenIsLocked=Yes`. Wait-unlock left running.
