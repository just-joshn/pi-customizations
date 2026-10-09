# Playbook: u-journey-cmd-typescript

Falsifiable done predicate. `parity/evidence/typescript/pair-typescript-paths-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record whether the loaded `typescript-best-practices` skill declares `paths` `**/*.ts` and `**/*.tsx`, `disable-model-invocation: true`, and body-first `type-system-discipline` (or honest fail/mismatch); report at `parity/briefs/reports/u-journey-cmd-typescript-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on skill-file frontmatter re-read (digest + YAML parse of the file each host actually loads). Medium on whether the agent also opens the principle leaf during the edit (metadata contract is the requirement under test).

## Phases

1. Scaffold held-out fixture `fixture-app/` with a tiny `.ts` and `.tsx` needing a branded-id / discriminant edit. Verify. Files present; fixture cwd trusted for Pi.
2. Write `parity/scripts/capture-typescript-paths.mjs` with residual-safe `/typescript-best-practices` prompt, live settle, and a deterministic frontmatter scorer over the host skill path. Verify. Locked models.mdc digest check present; scorer unit cases pass.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Re-read settled screens, Pi session skill blocks, and the skill files on disk. Score paths / disable-model-invocation / type-system-discipline-first. Verify. Per-host verdicts on disk in `observations.json`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or scenario stubs.
- Committing.
- Patching the Pi package skill if `paths` is missing (honest product gap only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Brand `UserId` in `src/id.ts` and tighten `src/Badge.tsx` status via `/typescript-best-practices`, residual-safe after Pi slash strip. Agents must not be told this is a frontmatter parity experiment.
