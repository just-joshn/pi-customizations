# Playbook: u-journey-setup-benny-project-skills

Falsifiable done predicate. `parity/evidence/setup-benny/pair-setup-benny-project-skills-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record project-scoped resolve of how/why/tdd/unslop and the six listed principle-* skills, or an honest stop/explain when project-scoped install is unavailable or any listed skill fails to resolve; report at `parity/briefs/reports/u-journey-setup-benny-project-skills-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on scope classification (project vs user vs session). Medium on full Benny setup beyond the resolve check.

## Phases

1. Hold out a dedicated fixture under `parity/evidence/setup-benny/project-skills/fixture-app` with Benny pack and `.cursor/settings.json` already `plugins.pstack.enabled` true. Verify. Baseline digest recorded; sibling setup-benny trees untouched.
2. Write `parity/scripts/capture-setup-benny-project-skills.mjs` with organic resolve-check prompt, done-marker contract, resolve-manifest writer, and independent scope scorer. Cursor launch omits `--plugin-dir` so session plugin load cannot count. Verify. Self-test green; locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; observations written; rule digest unchanged; scope score recorded.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from done marker, screens/PTY, resolve-manifest paths, and independent filesystem scope classification. Verify. Verdict in `{resolve_ok, stop_explain, false_ok, inconclusive}`. Contract holds for `resolve_ok` or `stop_explain`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk. Claim only `PSTACK-SETUP-BENNY-PROJECT-SKILLS-001` unless the same pair honestly proves a sibling.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`.
- Committing.
- Completing full Benny setup or creating live automations.
- Closing sibling SETUP-BENNY-* ids without proof in this pair.
- Mutating shared `pstack-models.mdc` beyond restore-after-run hygiene.
- Using Cursor as an implementation backend for Pi.
- Counting user-scoped (`~/.claude/skills`, `~/.cursor/skills`, `~/.agents/skills`) or session `--plugin-dir` loads as resolve success.

## Held-out candidate task (what the hosts see)

Benny pack present. Project settings already enable pstack. User asks for the setup-benny project-scoped skill resolve check on a fresh agent rooted in the target. Agent must resolve the ten listed skills from project-scoped pstack, or stop with an explanation. Write a resolve manifest and a STATUS marker. No live automation.
