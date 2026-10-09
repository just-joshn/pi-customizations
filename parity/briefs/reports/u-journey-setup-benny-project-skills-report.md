# u-journey-setup-benny-project-skills report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both sides completed the setup-benny project-scoped skill resolve check after `plugins.pstack.enabled` was already true, and both stopped with an explanation rather than counting user- or package-scoped loads as success. Ledgers not edited by this worker. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `59fc7130-bd2d-4edc-8ee0-f491ed12128a` |
| pi | `29b59723-b273-423c-a63a-524b3040157d` |

Pair. `parity/evidence/setup-benny/pair-setup-benny-project-skills-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true`)

Settings seed digest. `94c1129b…178f6` (`plugins.pstack.enabled` true)

## Project-scoped resolve or honest stop/explain?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **stop_explain (contract held)** | `STATUS=stop-explain reason=skills only resolve from user scope, not project pstack`. Manifest lists all ten under `~/.claude/skills`. Launch argv had no `--plugin-dir`. Independent `classifySkillPath` marks all `user`. |
| pi | **stop_explain (contract held)** | `STATUS=stop-explain reason=no project-scoped pi package; pstack only via user-level settings`. Manifest paths under `extensions/pi-pstack/skills`. Independent scopes all `package` (not fixture `.pi/skills`). Session tools read FOR_AGENTS, setup-benny, wrote manifest. |

Worker playbook. `parity/evidence/setup-benny/PLAYBOOK-project-skills.md`

Capture lever. `parity/scripts/capture-setup-benny-project-skills.mjs` (self-test green before live runs)

Dedicated fixture. `parity/evidence/setup-benny/project-skills/`

## Commands run

1. Confirmed models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Rsynced held-out fixture under `project-skills/fixture-app`, seeded settings with `pstack.enabled` true.
3. Wrote `PLAYBOOK-project-skills.md` and capture script. Self-test green.
4. `node parity/scripts/capture-setup-benny-project-skills.mjs --cursor-only` → `59fc7130…`.
5. `node parity/scripts/capture-setup-benny-project-skills.mjs --pi-only` → `29b59723…`.
6. Re-imported `analyzeManifest` on saved manifests (package-path classifier fix). Outcomes unchanged. Wrote pair JSON + this report.

## Deviations

1. Sequential `--cursor-only` then `--pi-only` on the dedicated fixture.
2. Cursor launch deliberately omits `--plugin-dir`. Session plugin load must not count for this requirement.
3. Prompt names the resolve contract and manifest shape. Boundary is proved by independent path classification, not self-report alone.
4. Pi claimed `scope: package` while the first classifier pass mislabeled those paths `user` because they live under `$HOME`. Classifier fixed; observations refreshed; outcomes still `stop_explain`.
5. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
6. Did not commit.
7. Did not claim sibling SETUP-BENNY-* ids.
8. Cross-model show-me-your-work reviewer skipped. Brief forbids further subagents.
9. Autonomous-run wake/`/loop` step skipped. Single capture timebox, not a multi-iteration wake loop.

## Honest product gaps

1. This pair proves the stop/explain branch when project-scoped install is unavailable or shadowed. It does not prove a green `resolve_ok` path with all ten skills under fixture `.pi/skills` or a true project-enabled plugin skill root distinct from user skills.
2. On this host, Cursor without `--plugin-dir` resolves the ten names from `~/.claude/skills` even with `plugins.pstack.enabled` true.
3. Pi ambient pstack host contract surfaces package skills from the checkout without a project `.pi/settings.json` packages pin or `.pi/skills` copies.
4. It does not prove pack merge, settings enable, secrets boundary, user-config-outside, required-explicit, control fail-closed, existing-no-automate, creation boundary, or thread safety.
5. Acceptance STATUS reason strings remain DRAFT / host-dependent.

## Suggested follow-ups for the coordinator

1. Merge the pair into the scenario / family ledger when ready. Keep `PSTACK-SETUP-BENNY-PROJECT-SKILLS-001` open if the oracle requires a green project-resolve success pair in addition to stop/explain.
2. Optional later pair: seed `.pi/skills` via `benny-setup.mjs` and empty agent home for Pi `resolve_ok`; for Cursor, isolate user skill roots or prove marketplace project plugin paths without user shadowing.
3. Keep sibling SETUP-BENNY scenarios on their own pairs.
