# Playbook: u-journey-setup-benny-pack-merge

Falsifiable done predicate. `parity/evidence/setup-benny/pair-setup-benny-pack-merge-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record a before/after fixture diff proving pack merge into `.cursor/automations/benny/` (required source files present at same relative paths, destination-only preserved, user-owned maps outside destination unchanged, conflict handled without discarding `PACK-MERGE-LOCAL-EDIT-MARKER` or stopping to ask), or an honest fail/mismatch; report at `parity/briefs/reports/u-journey-setup-benny-pack-merge-report.md`; ledgers untouched; no commit; no fabricated pairs; no real secrets.

Rigor. High on on-disk merge semantics (create missing paths, preserve dest-only, protect user-owned, conflict). Medium on how far setup proceeds beyond pack merge.

## Phases

1. Hold out dedicated fixture under `parity/evidence/setup-benny/pack-merge/fixture-app` with full source pack at `.upstream/automations/benny`, partial destination (DESTINATION_ONLY + locally edited README), and user-owned `.cursor/benny/` markers. Verify. Baseline digests recorded; shared `fixture-app` / no-secret / settings-enable paths untouched.
2. Write `parity/scripts/capture-setup-benny-pack-merge.mjs` with organic merge prompt, fixture reset, done-marker contract, and before/after merge scorer. Verify. Self-test green; locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged; merge score recorded.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, screens/PTY, session tools, and filesystem before/after. Verify. Verdict in `{merge_ok, merge_mismatch, no_merge, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk. Claim only `PSTACK-SETUP-BENNY-PACK-MERGE-001` unless the same pair honestly proves a sibling.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.
- Committing.
- Completing full Benny setup, settings enable, or creating live automations.
- Closing sibling SETUP-BENNY-* ids without proof in this pair.
- Mutating shared `pstack-models.mdc` beyond restore-after-run hygiene.
- Using Cursor as an implementation backend for Pi.
- Using real secrets.
- Racing settings-enable / no-secret writers of the shared fixture-app.

## Held-out candidate task (what the hosts see)

This repository is the merge target. Source pack is `.upstream/automations/benny/` (has `FOR_AGENTS.md`). Destination `.cursor/automations/benny/` already has `DESTINATION_ONLY.md` and a locally edited `README.md`. User-owned config/maps live under `.cursor/benny/`. Agent merges the source pack per setup-benny rules, preserves destination-only and user-owned files, merges the README conflict without discarding local edits (or asks), verifies required pack files, creates no live automation, then writes a `STATUS=` marker.
