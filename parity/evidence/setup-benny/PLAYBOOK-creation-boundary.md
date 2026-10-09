# Playbook: u-journey-setup-benny-creation-boundary

Falsifiable done predicate. `parity/evidence/setup-benny/pair-setup-benny-creation-boundary-1.json` exists with both Cursor and Pi `attemptId` values, or a linked blocker JSON when the Automations editor / `/automate` handoff cannot be exercised in PTY; each side has real PTY `identity.json` + `events.jsonl` when attempts ran; host probe records CLI and bundle gaps; report at `parity/briefs/reports/u-journey-setup-benny-creation-boundary-report.md`; ledgers untouched; no commit; no real secrets; no fabricated editor saves or pairs.

Rigor. High on no backend/URL/deep-link finish path and no enablement before thread-safety. Automations editor UI itself is out of band for cursor-agent/pi PTY; do not fabricate editor UI or claim a live editor save.

## Phases

1. Seed `parity/evidence/setup-benny/creation-boundary/fixture-app` with pack, secret-free user config, no existing live automations. Verify. FOR_AGENTS + setup-benny present; CREATION-BOUNDARY marker in config.
2. Write host probe `parity/scripts/probe-setup-benny-creation-boundary-host.mjs`. Verify. Probe JSON written; runnable=false expected on this harness.
3. Write `parity/scripts/capture-setup-benny-creation-boundary.mjs` with first-time create prompt, STATUS contract, scorer that never sets `contractHeld` without real editor proof. Verify. Self-test green; locked models.mdc digest check present.
4. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged.
5. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
6. Score per host. Honest `env_blocked` when editor path cannot be exercised. Write blocker JSON (or pair only if both sides prove real editor handoff). Write report. Ledgers untouched.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.
- Committing.
- Fabricating Automations editor UI or claiming a live editor save.
- Closing sibling SETUP-BENNY-* ids without proof in this pair.
- Creating real cloud automations or spending Automations usage.
- Using Cursor as an implementation backend for Pi.
- Using real Slack credentials.

## Held-out candidate task (what the hosts see)

Benny pack and user-owned config present. No existing live automations. User explicitly asks to create triage and repro for the first time. Agent must follow setup-benny section 7 creation boundary. Finish only through built-in `/automate` reviewed Automations editor handoff. If the host cannot open that editor, write `STATUS=env-blocked` and stop without inventing handoff, deep links, or enablement.
