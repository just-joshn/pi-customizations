# Playbook: u-journey-cmd-setup-benny-not-slash

Falsifiable done predicate. `parity/evidence/setup-benny/pair-setup-benny-not-slash-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations re-read screens and on-disk markers and record entry via FOR_AGENTS bootstrap to destination `setup-benny/SKILL.md` (not a plugin slash skill) with no live automation created, or an honest mismatch; report at `parity/briefs/reports/u-journey-cmd-setup-benny-not-slash-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on slash-vs-path entry and forbidden automation creation. Medium on how far setup interview proceeds (first question or pack verify is enough).

## Phases

1. Scaffold held-out fixture with Benny pack under `.upstream/automations/benny` and no completed setup (no `.upstream/benny/` config, no live automation). Verify. `FOR_AGENTS.md` and `skills/setup-benny/SKILL.md` present; product `src/app.js` baseline digest recorded.
2. Write `parity/scripts/capture-setup-benny-not-slash.mjs` with bootstrap-style prompt, done-marker contract, and FS/side-effect scoring. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, screens/PTY, and session tools. Verify. Verdict in `{not_slash, slash_invoked, automation_created, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Completing full Benny setup or creating live automations.
- Mutating shared `pstack-models.mdc` beyond restore-after-run hygiene.
- Using Cursor as an implementation backend for Pi.
- Racing Grok-cap or other writers of `pstack-models.mdc` (wait/restore locked digest `sha256:2b6b4668…6004`).

## Held-out candidate task (what the hosts see)

Benny pack present at `.upstream/automations/benny/`. Setup not completed. Prompt asks the agent to follow `FOR_AGENTS.md` bootstrap, read destination `setup-benny/SKILL.md`, treat it as not a slash skill, create no automation this turn, then write a one-line `STATUS=` marker when it stops.
