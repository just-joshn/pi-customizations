# Playbook: u-journey-cmd-unslop

Falsifiable done predicate. `parity/evidence/unslop/pair-unslop-process-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record whether `/unslop` activated and whether on-disk prose was rewritten with before/after evidence (or an honest fail/mismatch); report published at `parity/briefs/reports/u-journey-cmd-unslop-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on skill activation and on-disk before/after prose (screens + file digests + pattern scan). Medium on perfect rule-by-rule cleanup (rewrite pass against the pattern list is the requirement under test).

## Phases

1. Scaffold held-out fixture `fixture-app/` (short `draft.md` packed with listed AI tells). Verify. Baseline digest of `draft.md` recorded; no rewrite outputs yet under `fixture-out/`.
2. Write `parity/scripts/capture-unslop-process.mjs` with residual-safe `/unslop` prompt and live FS poll of `draft.md` digest change. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; poll log written; rule digest unchanged; before/after prose snapshots saved.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score skill activation and rewrite from poll logs, screens, and before/after pattern counts. Verify. Per-host verdict in `{rewrite_applied, skill_only, rewrite_without_skill_signal, neither, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if a side skips the rewrite (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Sloppy `draft.md` for a tiny notes tool, invoked via `/unslop`, residual-safe after Pi slash strip. Agents must not be told this is a parity skill-activation experiment.
