# u-journey-cmd-poteto-todo report

## Status

**partial** for the capture brief. Linked Cursor+Pi pair on real PTY with honest host deltas. Cursor put verbatim Bug fix playbook steps into a todolist before product work. Pi opened `bug-fix.md` and edited product with no TodoWrite or checklist. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `ff0f431a-1d09-40e2-b395-16a031182476` |
| pi | `3d51f05d-e208-417b-835f-75df86da0a47` |

Pair. `parity/evidence/poteto-playbook/pair-poteto-playbook-todo-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Playbook todos before product?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | Screen/PTY poll. Todo visible `2026-10-08T19:52:26.654Z`; playbook-step text (verbatim Bug fix `Reproduce it yourself...`) at `2026-10-08T19:52:44.637Z`; first product `src/inc.js` at `2026-10-08T19:53:32.719Z`. Settled screen still shows checked Bug fix steps plus `Playbook steps.` summary with skip reasons. `done.txt` = `Bug fix`. |
| pi | **no** | FS poll first product at `2026-10-08T19:54:45.616Z`. Session `01a11d14…` tool order `read` (bug-fix.md) → `bash` → `bash` (mutates `src/inc.js`) → `edit` → `bash` (done.txt). No `TodoWrite`. `done.txt` = `bug-fix`. |

Worker capture playbook. `parity/evidence/poteto-playbook/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. Wrote worker `PLAYBOOK.md`, fixture-app (buggy `src/inc.js`), then `parity/scripts/capture-poteto-playbook-todo.mjs`.
4. `node parity/scripts/capture-poteto-playbook-todo.mjs --cursor-only` (~121s).
5. `node parity/scripts/capture-poteto-playbook-todo.mjs --pi-only` (~24s).
6. Re-read screens, poll logs, Cursor PTY decode, Pi session tool order.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Pi did not exercise todolist discipline. Honest fail recorded; no product gate added in this brief (scope is capture only).
3. Pi screen still shows an unrelated `tdd` skill-collision banner. `poteto-mode` itself loaded from `extensions/pi-pstack/skills/poteto-mode`.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or the family-05 stub.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-05 / `cmd-poteto-playbook-todo` evidence when ready. Keep `PSTACK-CMD-POTETO-PLAYBOOK-TODO-001` open until Pi matches or a deliberate exclusion is frozen.
2. Optionally add a Pi poteto-mode todolist gate analogous to `registerFigureItOutPlaybookGate`, then recapture Pi.
3. Optionally clear or document the Pi `tdd` collision chrome so family-05 screens stay on-topic.
