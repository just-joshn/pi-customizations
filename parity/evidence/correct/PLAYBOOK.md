# Playbook: u-journey-cmd-correct

Falsifiable done predicate. `parity/evidence/correct/pair-correct-encode-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record whether `/correct` encoded a recurring mistake at the highest working level and proved the check fails on a past mistake (or an honest fail/mismatch); report at `parity/briefs/reports/u-journey-cmd-correct-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on encoding level (architecture, then types/lint, then test, docs last) and on fail-on-past-mistake proof. Medium on identical encoding mechanism across hosts.

Oracle. Requirement `PSTACK-CMD-CORRECT-ENCODE-001` and scenario `cmd-correct-encode`.

## Phases

1. Scaffold held-out `fixture-app/` with a twice-seen mistake class and a past-mistake specimen. Verify. Baseline under `fixture-baseline/`; no `done.txt` yet.
2. Write `parity/scripts/capture-correct-encode.mjs`. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; rule digest unchanged; markers when written.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score from screens, PTY bytes, written enforcement files, and Pi session. Verify. Per-host verdict in `{encoded_with_proof, encoded_docs_only, encoded_no_proof, skill_only, neither, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if a side fails (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Fixture mines show agents twice imported `src/db.js` from feature modules instead of `src/store.js`. Docs-only rule already exists in `AGENTS.md`. `/correct` must raise enforcement above docs and prove the check fails on `history/past-mistake-1.js`. Agents must not be told this is a parity skill-activation experiment.
