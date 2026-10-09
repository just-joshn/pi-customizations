# Playbook: u-journey-setup-benny-user-config-outside

Falsifiable done predicate. `parity/evidence/setup-benny/pair-setup-benny-user-config-outside-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations prove user-owned configuration, feature map, and routing map live outside `.cursor/automations/benny/`, copied example digests are unchanged, and product `src/app.js` is unchanged, or an honest fail/mismatch; report at `parity/briefs/reports/u-journey-setup-benny-user-config-outside-report.md`; ledgers untouched; no commit; no fabricated pairs; no real secrets.

Rigor. High on outside-pack placement and example immutability. Medium on fill quality of placeholders. Low on live automation creation (forbidden here).

## Phases

1. Hold out dedicated fixture under `parity/evidence/setup-benny/user-config-outside/fixture-app` with full copied pack at `.cursor/automations/benny/` (examples marked), upstream mirror, and no pre-existing `.cursor/benny/` user-owned files. Verify. Baseline example digests locked; pack-merge / settings-enable / no-secret paths untouched.
2. Write `parity/scripts/capture-setup-benny-user-config-outside.mjs` with adapt-config prompt, fixture reset from seed examples, done-marker contract, and before/after outside-placement scorer. Verify. Self-test green; locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, screens/PTY, and filesystem before/after. Verify. Verdict in `{adapt_ok, adapt_mismatch, no_adapt, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk. Claim only `PSTACK-SETUP-BENNY-USER-CONFIG-OUTSIDE-001`.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.
- Committing.
- Completing pack merge, settings enable, or creating live automations.
- Closing sibling SETUP-BENNY-* ids without proof in this pair.
- Using Cursor as an implementation backend for Pi.
- Using real secrets.
- Racing pack-merge / settings-enable / control-fail-closed writers.

## Held-out candidate task (what the hosts see)

Pack copy is already done under `.cursor/automations/benny/`. Agent follows setup-benny section 2 (adapt the configuration). Creates user-owned configuration.yaml, feature-map.md, and routing.md outside `.cursor/automations/benny/` (for example under `.cursor/benny/`), adapts placeholders with fixture-safe public values, does not edit the copied examples, creates no live automation, then writes a `STATUS=` marker.
