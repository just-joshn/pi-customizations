# Playbook: u-journey-cmd-benny-repro

Falsifiable done predicate. `parity/evidence/benny-repro/pair-benny-repro-fail-closed-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations re-read screens and on-disk markers and record fail-closed (no UI repro, no product edits under `src/`, no draft PR) or an honest mismatch; report at `parity/briefs/reports/u-journey-cmd-benny-repro-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on forbidden side effects (product digest, draft-PR signals, control/UI tooling). Medium on exact fail-closed phrasing (host-dependent per prior DRAFT notes).

## Phases

1. Scaffold held-out fixture with Benny pack under `.upstream/automations/benny` and intentionally incomplete `.upstream/benny/configuration.yaml` (no control adapter, no feature map, no required Slack/PR actions). Verify. Pack `SKILL.md` present; product `src/app.js` baseline digest recorded.
2. Write `parity/scripts/capture-benny-repro-fail-closed.mjs` with automation-style prompt that points at the incomplete config, done-marker contract, and FS/side-effect scoring. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, product digest, screens/PTY, and session tools. Verify. Verdict in `{fail_closed, proceeded, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Completing Benny setup or inventing a working control adapter.
- Mutating shared `pstack-models.mdc` beyond restore-after-run hygiene.
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Benny pack present. Incomplete external config at `.upstream/benny/configuration.yaml`. Prompt asks the agent to start `reproduce-and-fix-issues` for a synthetic Slack trigger using that config path, then write a one-line `STATUS=` marker when it stops.
