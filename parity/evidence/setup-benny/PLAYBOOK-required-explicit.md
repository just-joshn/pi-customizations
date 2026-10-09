# Playbook: u-journey-setup-benny-required-explicit

Falsifiable done predicate. `parity/evidence/setup-benny/pair-setup-benny-required-explicit-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; the held-out prompt supplies explicit repository, triage identity, tracker adapter, control skill, and feature map, but leaves source Slack channel ID unknown; each host fails closed rather than inventing a channel or enabling a live automation (or the pair records an honest proceed-with-ambiguity / env blocker); report at `parity/briefs/reports/u-journey-setup-benny-required-explicit-report.md`; ledgers untouched; no commit; no real secrets; no fabricated pairs.

Rigor. High on fail-closed for the missing required value (done marker + config/automation side effects). Medium on model-slug picker checks (hosts must not invent a private default slug when asked to use only available ones).

## Phases

1. Seed dedicated fixture under `parity/evidence/setup-benny/required-explicit/fixture-app` from the shared Benny pack. Verify. Pack `FOR_AGENTS.md` and `setup-benny/SKILL.md` present; no pre-filled user config that invents a source channel.
2. Write `parity/scripts/capture-setup-benny-required-explicit.mjs` with ambiguous-channel prompt, STATUS contract, and scorer. Verify. Self-test green; locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, screens/PTY, written config channel field, and automation side effects. Verify. Verdict in `{fail_closed, proceeded_ambiguous, completed, blocked, inconclusive}`. Contract held only for `fail_closed`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk. Claim only `PSTACK-SETUP-BENNY-REQUIRED-EXPLICIT-001`.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.
- Committing.
- Happy-path full setup that needs live Slack or real automations.
- Closing sibling SETUP-BENNY-* ids without proof in this pair.
- Mutating shared `pstack-models.mdc` beyond restore-after-run hygiene.
- Using Cursor as an implementation backend for Pi.
- Using real Slack credentials or inventing channel IDs in the prompt.

## Held-out candidate task (what the hosts see)

Benny pack present. User supplies explicit repository URL/branch, triage Slack user ID, tracker adapter skill name, control skill name, and feature-map path. Source Slack channel ID is unknown / TBD. Models must use only available picker/list slugs. Agent must fail setup rather than invent the channel or create a live automation. Done marker when it stops.
