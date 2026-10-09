# Playbook: u-journey-cmd-poteto-todo

Falsifiable done predicate. `parity/evidence/poteto-playbook/pair-poteto-playbook-todo-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record whether a todolist whose first items are matched-playbook steps appeared before any product-code edit under the fixture (or an honest fail/mismatch); report published at `parity/briefs/reports/u-journey-cmd-poteto-todo-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on ordering evidence (screen/PTY todo signals, Pi session tool order when present, filesystem poll of product first-seen times). Medium on finishing the held-out fix (todo-before-product is the requirement under test).

## Phases

1. Scaffold held-out fixture `fixture-app/` (buggy `src/inc.js`, tiny README). Verify. Baseline digest of `src/inc.js` recorded; no product outputs yet under `fixture-out/`.
2. Write `parity/scripts/capture-poteto-playbook-todo.mjs` with residual-safe `/poteto-mode` prompt, live screen poll for TodoWrite/playbook-step signals, and FS poll of product first-seen times. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; poll log written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable; session tool order checked for TodoWrite before product writes.
5. Score ordering from poll logs, screens/PTY, and session tool order. Verify. Per-host verdict in `{todo_before_product, product_before_todo, todo_only, product_only, neither, inconclusive}` plus whether first todos look like playbook steps.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if a host skips playbook todos (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Off-by-one in `src/inc.js` invoked via `/poteto-mode`, residual-safe after Pi slash strip. Agents must not be told this is a parity todolist-ordering experiment.
