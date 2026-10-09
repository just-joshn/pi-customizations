# Playbook: u-journey-cmd-benny-triage

Falsifiable done predicate. `parity/evidence/benny-triage/pair-benny-triage-fail-closed-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations re-read screens and on-disk markers and record fail-closed (no Slack post, no tracker write, no reproduce-or-fix work inside triage) or an honest mismatch; report at `parity/briefs/reports/u-journey-cmd-benny-triage-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on forbidden side effects (Slack write chrome, tracker create/update, reproduce-and-fix skill work). Medium on exact fail-closed phrasing (host-dependent).

## Phases

1. Scaffold held-out fixture with Benny pack under `.upstream/automations/benny` and intentionally incomplete `.upstream/benny/configuration.yaml` (no Slack post/read actions, no tracker adapter ops, no routing map). Verify. Pack `triage-issue-reports/SKILL.md` present; product `src/app.js` baseline digest recorded.
2. Write `parity/scripts/capture-benny-triage-fail-closed.mjs` with automation-style prompt that points at the incomplete config, done-marker contract, and FS/side-effect scoring. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, screens/PTY, and session tools. Verify. Verdict in `{fail_closed, proceeded, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Completing Benny setup or inventing working Slack/tracker actions.
- Mutating shared `pstack-models.mdc` beyond restore-after-run hygiene.
- Using Cursor as an implementation backend for Pi.
- Capturing the valid-config positive path (one thread-only verdict). This pair is the incomplete-config fail-closed entry only.

## Held-out candidate task (what the hosts see)

Benny pack present. Incomplete external config at `.upstream/benny/configuration.yaml`. Prompt asks the agent to start `triage-issue-reports` for a synthetic Slack trigger using that config path, then write a one-line `STATUS=` marker when it stops.
