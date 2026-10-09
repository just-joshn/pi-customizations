# Playbook: u-journey-cmd-tech-writing

Falsifiable done predicate. `parity/evidence/technical-writing/pair-technical-writing-docs-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record whether `/technical-writing` (or docs playbook) activated and whether structured Diátaxis-shaped docs landed under the fixture (or an honest fail/mismatch); report published at `parity/briefs/reports/u-journey-cmd-tech-writing-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on skill activation and on-disk docs shape (screens + file polls + README/docs body). Medium on STE/Global English sentence polish (shape and mode split are the requirement under test).

## Phases

1. Scaffold held-out fixture `fixture-app/` (messy draft `README.md`, tiny `src/greet.js`, no `docs/`). Verify. Baseline digest of `README.md` recorded; no docs outputs yet under `fixture-out/`.
2. Write `parity/scripts/capture-technical-writing-docs.mjs` with residual-safe `/technical-writing` prompt and live FS poll of docs vs product first-seen times. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; poll log written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score skill activation and Diátaxis structure from poll logs, screens, and written docs. Verify. Per-host verdict in `{structured_docs, skill_only, docs_unstructured, neither, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if a side ignores Diátaxis (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Messy draft README for a tiny greet CLI, invoked via `/technical-writing`, residual-safe after Pi slash strip. Agents must not be told this is a parity skill-activation experiment.
