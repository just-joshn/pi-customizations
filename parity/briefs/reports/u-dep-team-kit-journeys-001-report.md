# Report: team-kit sample journey pairs

## Status

VERIFIED for one sampled skill (`verify-this`) on both hosts. Full cursor-team-kit skill-set journey closure is **not** ready. Skills paired count: **1** of 18. create-skill-style full closure ready: **no**.

## Attempts

| Skill | Host | Attempt ID | Outcome |
| --- | --- | --- | --- |
| verify-this | Cursor | `abb96d2b-c7d7-4012-9f4d-956e4e605743` | `verdict.md` first line `VERIFIED`; `STATUS=verified` |
| verify-this | Pi | `8f04dd82-a425-474f-95dc-b1a005c43169` | same oracle; seeded locked `SKILL.md` under `.pi/skills/verify-this/` |

## Artifacts

- Pair: `parity/evidence/team-kit/pair-team-kit-verify-this-1.json`
- Capture lever: `parity/scripts/capture-team-kit-verify-this.mjs`
- Progress matrix: `parity/research/dep-closure-wave-009/team-kit/journey-progress-u-dep-team-kit-journeys-001.json`
- Decision log: `parity/evidence/team-kit/.audit/u-dep-team-kit-journeys-001.tsv`
- Cursor durable verdict: `parity/evidence/team-kit/fixture-out/cursor/verify-this/verdict.md`
- Pi durable verdict: `parity/evidence/team-kit/fixture-out/pi/verify-this/verdict.md`

## Sample skill SKILL.md re-hash (measured)

| Skill | Path | sha256 | Matches wave-009? |
| --- | --- | --- | --- |
| verify-this | `parity/reference/cursor-plugins/cursor-team-kit/skills/verify-this/SKILL.md` | `c1c7b27c1133085bd3409c601ea12b6e6f61b4b23debcd52bc248fc01907e7de` | yes |
| deslop | `.../deslop/SKILL.md` | `2f7b7def74af7ed11f5b44b4d32f0f91fca8c5d1f92bf2171e8d12fd33a0f810` | yes |
| fix-ci | `.../fix-ci/SKILL.md` | `925f8c3e11de8bcc0cd015ec907f4d00b12cde6714246554ed3a52e096536522` | yes |
| review-and-ship | `.../review-and-ship/SKILL.md` | `5c8e88c91e726e024c824d2b02be6bfc7ad81ac5e67c104ef2b66840715373c1` | yes |
| control-cli | `.../control-cli/SKILL.md` | `13ac93e595bbda2000849bdb815d5f2ca03f7c2ca63788c8335f9212b9b422a2` | yes |

Pi seeded copy of verify-this matched the locked hash byte-for-byte.

## Wave-009 sample disposition

| Skill | This unit |
| --- | --- |
| verify-this | closed by pair `team-kit-verify-this-1` |
| deslop | still open (local-runnable; lever not built) |
| fix-ci | still open (needs PR checks surface) |
| review-and-ship | still open (needs git commit + PR surface; worker brief forbids ledger commits) |
| control-cli | still open (local-runnable; lever not built) |

## Oracle checks (re-read)

Both sides wrote `claim.md` and `verdict.md` under `fixture-out/<side>/verify-this/`. First non-empty verdict line is `VERIFIED`. Done markers are `STATUS=verified`. Cursor loaded team-kit via `--plugin-dir`. Pi used project `.pi/skills/verify-this/SKILL.md` seeded from the locked distribution. Real PTY both sides.

## Exhaustive plan for remaining 17

Keep the unresolvedReference open. Do not invent pairs.

1. Local-next levers (same pattern as verify-this): `deslop`, `control-cli`, `check-compiler-errors`, `fix-merge-conflicts`, `thermo-nuclear-code-quality-review`, `what-did-i-get-done`, `weekly-review`.
2. GitHub/CI-bound: `fix-ci`, `loop-on-ci`, `get-pr-comments`, `make-pr-easy-to-review`, `new-branch-and-pr`, `pr-review-canvas`, `review-and-ship` against a fixture repo or live PR owned by the coordinator.
3. Browser/heavy: `control-ui`, `run-smoke-tests`.
4. Chat-history-bound: `workflow-from-chats`.

No skill was classified non-applicable. Standing preferences forbid scope reduction for platform differences.

## Merge payload (coordinator)

```json
{
  "unresolvedReferenceAction": "keep_open",
  "skillsPairedCount": 1,
  "createSkillStyleFullClosureReady": false,
  "suggestedWaveNote": "u-dep-team-kit-journeys-001 closed verify-this via real PTY pair (cursor abb96d2b, pi 8f04dd82). 17 of 18 team-kit skill journeys remain open. Do not remove the full skill-set unresolvedReference."
}
```

## Honest gaps

- Only the verify-this sample row closed. The other four wave-009 sample seeds remain `not_run`.
- Full 18-skill create-skill-style closure would need seventeen more pairs (or measured N/A dispositions). None of those were invented.
- Ledgers were not edited. No commit.

## Acceptance

Met: at least one sampled skill closed with Cursor+Pi attempt IDs. Full skill-set reference close was not claimed.
