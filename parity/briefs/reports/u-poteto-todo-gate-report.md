# u-poteto-todo-gate report

## Status

**pass.** POTETO-PLAYBOOK-TODO closed on a linked Cursor+Pi pair. Both hosts `playbookTodosBeforeProduct`. Gate unit tests green. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID | Ordering |
| --- | --- | --- |
| cursor | `ff0f431a-1d09-40e2-b395-16a031182476` | playbookTodosBeforeProduct (reuse pair-1; fixture digest unchanged) |
| pi | `6954317a-4e7e-42d9-b6ca-1c4a1651531a` | playbookTodosBeforeProduct (fresh `--pi-only` after gate) |

Pair. `parity/evidence/poteto-playbook/pair-poteto-playbook-todo-2.json`

Prior fail. `parity/evidence/poteto-playbook/pair-poteto-playbook-todo-1.json` (Pi product-first, no TodoWrite).

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Playbook todos before product?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | Reuse pair-1. Playbook-step TodoWrite at `2026-10-08T19:52:44.637Z`; first product `src/inc.js` at `2026-10-08T19:53:32.719Z`. |
| pi | **yes** | FS poll. Playbook TodoWrite at `2026-10-08T20:01:42.581Z`; first product at `2026-10-08T20:01:46.419Z`. Session `01a11d1b…` blocked early bash with the gate message, then TodoWrite with verbatim Bug fix steps before the sed that mutates `src/inc.js`. |

## Product change (commit-worthy summary, not committed)

Added `registerPotetoPlaybookTodoGate` beside the how/why/fio gates. On an expanded `<skill name="poteto-mode">` turn or sticky poteto mode it injects a playbook-todo usage section, blocks `bash`/`edit`/`write` until a `TodoWrite` whose todos match capture-recognized playbook step text, and nudges once on settle if none landed. Soft `firstActionRule` stays for Anthropic models; the hard gate is what closed the miss.

## Commands run

1. Unit tests. `bun run test -- test/poteto-playbook-todo-gate.test.ts test/structure.test.ts` → 16 passed.
2. Trusted fixture cwd already in `/tmp/pi-ref-agent/trust.json`.
3. `node parity/scripts/capture-poteto-playbook-todo.mjs --pi-only` (~35s). Exit 0. `playbookTodosBeforeProduct: true`.
4. Re-read Pi poll, screens, session tool results (gate block text on first bash).

## Deviations

1. Reused Cursor pair-1 attempt (brief allows reuse when fixture identical). Fresh Pi only.
2. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
3. Did not commit.
4. Bug-fix playbook steps 5–6 skipped here (no commit / no PR per brief FORBIDDEN).

## Suggested follow-ups for the coordinator

1. Point family-05 / POTETO-PLAYBOOK-TODO at pair-2 and mark the mismatch reconciled.
2. Land the gate sources when ready to commit.
