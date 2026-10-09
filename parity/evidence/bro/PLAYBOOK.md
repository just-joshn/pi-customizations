# Playbook: u-journey-cmd-bro

Falsifiable done predicate. `parity/evidence/bro/pair-bro-restate-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record whether `/bro` restated the prior jargon-heavy assistant message in plain language before any product action (or an honest fail/mismatch); report at `parity/briefs/reports/u-journey-cmd-bro-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on ordering (jargon reply settles, then `/bro`, then plain restatement) and on forbidden product continuation. Medium on wording identity across hosts.

Oracle. Requirement `PSTACK-CMD-BRO-RESTATE-001` and scenario `cmd-bro-restate`. Brief title says "restates the ask"; the frozen requirement expects a plain restatement of the last agent message. Capture follows the requirement.

## Phases

1. Scaffold held-out `fixture-app/` (tiny README only). Verify. No marker files under `fixture-out/` yet.
2. Write `parity/scripts/capture-bro-restate.mjs` (two turns: jargon-only explain, then `/bro` with residual-safe marker paths). Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens for both turns, identity, events; rule digest unchanged; `restate.md` / `done.txt` when the host writes them.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score from screens, PTY bytes, and Pi session. Verify. Per-host verdict in `{restate_plain, restate_still_jargon, continued_prior_task, skill_only, neither, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if a side fails (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Turn 1 asks for a short jargon-dense systems explanation with no file edits. Turn 2 is `/bro` plus write the plain restatement to a marker file. Agents must not be told this is a parity skill-activation experiment.
