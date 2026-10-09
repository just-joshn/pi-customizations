# Playbook: u-journey-setup-benny-control-fail-closed

Falsifiable done predicate. `parity/evidence/setup-benny/pair-setup-benny-control-fail-closed-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record setup-benny step 6 control verification that leaves the repro automation disabled when the named control skill lacks required capabilities, or record an honest fail/mismatch; report at `parity/briefs/reports/u-journey-setup-benny-control-fail-closed-report.md`; ledgers untouched; no commit; no fabricated pairs; no real secrets.

Rigor. High on fail-closed (missing capability → repro stays disabled). Medium on how deeply the agent exercises the stub skill beyond reading it.

## Phases

1. Hold out a dedicated fixture under `parity/evidence/setup-benny/control-fail-closed/fixture-app` with Benny pack, completed feature map, named control skill stub that lists required capabilities as unimplemented, and user-owned config pointing at both. Verify. Baseline digests recorded; shared sibling evidence roots untouched.
2. Write `parity/scripts/capture-setup-benny-control-fail-closed.mjs` with organic step-6 prompt, done-marker contract, and FS/side-effect scoring. Verify. Self-test green; locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, screens/PTY, session tools, product digest, and live-automation side effects. Verify. Verdict in `{fail_closed, control_ok, automation_enabled, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk. Claim only `PSTACK-SETUP-BENNY-CONTROL-FAIL-CLOSED-001` unless the same pair honestly proves a sibling.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.
- Committing.
- Completing full Benny setup or creating live automations.
- Closing sibling SETUP-BENNY-* ids without proof in this pair.
- Mutating shared `pstack-models.mdc` beyond restore-after-run hygiene.
- Using Cursor as an implementation backend for Pi.
- Using real secrets.

## Held-out candidate task (what the hosts see)

Named control skill `control-target-app` and completed `.cursor/benny/feature-map.md` exist. The skill stub marks every required control-adapter capability as not implemented. User asks for Benny setup step 6 (verify control adapter) before enabling the repro automation. Agent should fail closed and leave repro disabled. No live automation. Done marker when it stops.
