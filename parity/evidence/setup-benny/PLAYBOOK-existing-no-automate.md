# Playbook: u-journey-setup-benny-existing-no-automate

Falsifiable done predicate. `parity/evidence/setup-benny/pair-setup-benny-existing-no-automate-1.json` exists with both Cursor and Pi `attemptId` values (or a linked blocker JSON when the Automations editor cannot be exercised in PTY); each side has real PTY `identity.json` + `events.jsonl` when attempts ran; seeded fixture lists existing `benny-triage` and `benny-reproduce` automations; each host avoids `/automate` for the update path, surfaces the setup-benny editor checklist, and does not create replacement/duplicate automations (or the pair records an honest env blocker); report at `parity/briefs/reports/u-journey-setup-benny-existing-no-automate-report.md`; ledgers untouched; no commit; no real secrets; no fabricated pairs.

Rigor. High on no-automate and no-duplicate creates. Medium on checklist completeness (scored from chrome + done marker). Automations editor UI itself is out of band for cursor-agent/pi PTY; do not fabricate editor UI.

## Phases

1. Seed dedicated fixture under `parity/evidence/setup-benny/existing-no-automate/fixture-app` with pack, user config, and existing live-automation stubs. Verify. Inventory names triage + repro; FOR_AGENTS + setup-benny present.
2. Write `parity/scripts/capture-setup-benny-existing-no-automate.mjs` with existing-update prompt, STATUS contract, and scorer. Verify. Self-test green; locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, screens/PTY, automate-skill signals, checklist chrome, and automation FS side effects. Verify. `contractHeld` only for `checklist_no_automate`. Honest `env_blocker` when editor path cannot be exercised and no-automate cannot be proven.
6. Write pair JSON (and blocker JSON if needed) + report + decision-trail rows. Verify. Done predicate above holds on disk. Claim only `PSTACK-SETUP-BENNY-EXISTING-NO-AUTOMATE-001`.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.
- Committing.
- Fabricating Automations editor UI or claiming a live editor save.
- Closing sibling SETUP-BENNY-* ids without proof in this pair.
- Mutating shared `pstack-models.mdc` beyond restore-after-run hygiene.
- Using Cursor as an implementation backend for Pi.
- Using real Slack credentials or real Automations cloud IDs.

## Held-out candidate task (what the hosts see)

Benny pack and user-owned config present. Fixture inventory says `benny-triage` and `benny-reproduce` already exist. User wants to update those existing automations, not create new ones. Agent must follow setup-benny section 7 existing path: do not use `/automate` to search/inspect/update; finish validation; give the concise editor checklist; ask the user to edit each automation in its Automations editor; do not create replacements or duplicates. Done marker when it stops.
