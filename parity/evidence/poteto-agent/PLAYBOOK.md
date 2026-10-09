# Playbook: u-journey-cmd-poteto-agent

Falsifiable done predicate. `parity/evidence/poteto-agent/pair-poteto-agent-read-skill-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record whether a fresh `poteto-agent` Task ran (not `generalPurpose` substitution) and whether that child loaded `poteto-mode` `SKILL.md` (Principles index included) before other work, or an honest fail/mismatch; report published at `parity/briefs/reports/u-journey-cmd-poteto-agent-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on spawn type and child tool order (parent Task args, child transcript Read of SKILL.md before other tools). Medium on finishing the held-out marker write (spawn+skill-read is the requirement under test).

## Phases

1. Scaffold held-out fixture `fixture-app/` (tiny README + empty marker slot). Verify. No product outputs yet under `fixture-out/`.
2. Write `parity/scripts/capture-poteto-agent-read-skill.mjs` with residual-safe `/poteto-mode` prompt forcing one fresh poteto-agent Task, live PTY screens, parent spawn scoring, and child-transcript skill-read ordering. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session + `subagents/` retained when discoverable.
5. Score spawn + skill-read from PTY, parent session/tool args, and child transcripts. Verify. Per-host verdict in `{skill_before_work, work_before_skill, skill_only, work_only, no_poteto_agent, generalPurpose_substituted, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if a host skips the SKILL.md read or substitutes generalPurpose (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Tiny marker write delegated via `/poteto-mode` to one fresh poteto-agent Task. Agents must not be told this is a parity skill-read-ordering experiment.
