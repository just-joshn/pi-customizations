# Playbook: u-journey-cmd-benny-triage-valid

Falsifiable done predicate. Either (A) `parity/evidence/benny-triage/pair-benny-triage-valid-1.json` exists with both Cursor and Pi `attemptId` values, real PTY identity+events, observations showing one thread-only verdict, no reproduce-or-fix inside triage, and no root-channel post, or (B) an honest environment-bound blocker artifact and report exist with no fabricated pair. Ledgers untouched. No commit.

Rigor. High on side effects and credential honesty. Do not invent Slack posts, bot tokens, or working action bindings.

## Phases

1. Probe whether valid-config triage can run without live Slack credentials or owner-gated customer messages. Verify. `parity/scripts/probe-benny-triage-valid-env.mjs` exit 0 means runnable; exit 2 means blocker.
2. If runnable, scaffold a complete-enough fixture (config + routing map + resolvable Slack/tracker adapters the skill accepts) without inventing secrets. Verify. Config loads and named actions resolve on both hosts.
3. Capture Cursor then Pi with real PTY. Verify. Attempt dirs have screens, identity, events; one thread-only verdict observed; no reproduce-and-fix; no root post.
4. Score and publish pair JSON + report. Verify. Done predicate (A) holds on disk.
5. If not runnable, publish blocker JSON + report naming the missing environment pieces. Verify. Done predicate (B) holds; no pair IDs invented.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.
- Committing.
- Fabricating Slack credentials, live channel posts, or a fake pass pair.
- Treating YAML placeholder action names as working adapters.
- Using Cursor as an implementation backend for Pi.
