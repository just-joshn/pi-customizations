# Playbook: u-journey-setup-benny-settings-enable

Falsifiable done predicate. `parity/evidence/setup-benny/pair-setup-benny-settings-enable-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record a setup turn that leaves `.cursor/settings.json` with `plugins.pstack.enabled` true while preserving unrelated top-level settings, other plugin entries, and JSONC comments when present, or record an honest fail/mismatch; report at `parity/briefs/reports/u-journey-setup-benny-settings-enable-report.md`; ledgers untouched; no commit; no fabricated pairs; no real secrets.

Rigor. High on settings merge semantics (enable + preserve + validate). Medium on how far setup proceeds beyond settings.

## Phases

1. Hold out a dedicated fixture under `parity/evidence/setup-benny/settings-enable/fixture-app` with Benny pack and a seeded JSONC `.cursor/settings.json` (`pstack.enabled` false, unrelated keys, other plugin, comment marker). Verify. Baseline file digest recorded; shared `fixture-app` / no-secret paths untouched.
2. Write `parity/scripts/capture-setup-benny-settings-enable.mjs` with organic settings-enable prompt, done-marker contract, and before/after settings scorer. Verify. Self-test green; locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged; settings score recorded.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, screens/PTY, session tools, and before/after settings parse (enable, preserve, comment, valid). Verify. Verdict in `{settings_ok, settings_mismatch, no_settings_write, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk. Claim only `PSTACK-SETUP-BENNY-SETTINGS-ENABLE-001` unless the same pair honestly proves a sibling.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.
- Committing.
- Completing full Benny setup or creating live automations.
- Closing sibling SETUP-BENNY-* ids without proof in this pair.
- Mutating shared `pstack-models.mdc` beyond restore-after-run hygiene.
- Using Cursor as an implementation backend for Pi.
- Using real secrets.

## Held-out candidate task (what the hosts see)

Benny pack present. Seeded `.cursor/settings.json` has JSONC comments, unrelated settings, another plugin, and `plugins.pstack.enabled` false. User asks for Benny setup step that enables pstack in project settings per setup-benny. Agent should set only `enabled` true, preserve the rest, keep comments, validate. No live automation. Done marker when it stops.
