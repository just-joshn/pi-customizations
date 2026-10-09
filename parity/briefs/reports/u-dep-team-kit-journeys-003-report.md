# Report: team-kit GitHub-bound journey pairs

## Status

VERIFIED for three GitHub-bound skills closed in this unit with real Cursor+Pi PTY pairs against a disposable fixture repo. On-disk pass pairs across prior waves plus this unit: **7** of 18. create-skill-style full closure ready: **no**.

## Newly closed this unit

| Skill | Host | Attempt ID | Outcome |
| --- | --- | --- | --- |
| get-pr-comments | Cursor | `89df0ce6-4afb-4b32-93b0-7c2c83af2380` | `STATUS=verified`; summary includes `FIXTURE_REVIEW_COMMENT` |
| get-pr-comments | Pi | `d63d2dfc-99a3-4732-831b-38dca83525c5` | same oracle; seeded locked `SKILL.md` |
| make-pr-easy-to-review | Cursor | `d4ab0577-1834-4685-a643-fbeac6ba42f3` | PR body + notes include `FIXTURE_REVIEW_GUIDANCE`; no force-push |
| make-pr-easy-to-review | Pi | `5239e674-1014-402c-a492-7a508b454454` | same |
| new-branch-and-pr | Cursor | `6337794e-d2c9-4a4e-b0ef-25551e3013bc` | opened https://github.com/just-joshn/team-kit-gh-fixture/pull/2 |
| new-branch-and-pr | Pi | `f76fbd4b-0e21-4bca-931c-b3fca1fb6088` | opened https://github.com/just-joshn/team-kit-gh-fixture/pull/3 |

## Fixture

- Repo: https://github.com/just-joshn/team-kit-gh-fixture
- Seed PR (comments + reviewability journeys): https://github.com/just-joshn/team-kit-gh-fixture/pull/1
- Local clone: `parity/fixtures/team-kit-gh/`
- Seeded discussion marker: `FIXTURE_REVIEW_COMMENT`
- CI on PR #1 measured `pass` via `gh pr checks` (not fabricated)

## Artifacts

- Lever: `parity/scripts/capture-team-kit-gh-skill.mjs`
- Pairs:
  - `parity/evidence/team-kit/pair-team-kit-get-pr-comments-1.json`
  - `parity/evidence/team-kit/pair-team-kit-make-pr-easy-to-review-1.json`
  - `parity/evidence/team-kit/pair-team-kit-new-branch-and-pr-1.json`
- Progress: `parity/research/dep-closure-wave-009/team-kit/journey-progress-u-dep-team-kit-journeys-003.json`
- Decision log: `parity/evidence/team-kit/.audit/u-dep-team-kit-journeys-003.tsv`
- Capture logs under `parity/evidence/team-kit/capture-*.log`

## SKILL.md re-hash (measured)

| Skill | sha256 | Matches wave-009 lock? |
| --- | --- | --- |
| get-pr-comments | `8bf292736cab922276feb4d8377edc2fc4102a7beb62bcd1f3f5cf72a79b16cc` | yes |
| make-pr-easy-to-review | `e8da0d4a85b7c04823698f539251617389f827fd9137100ef7eaea5dcc992fe7` | yes |
| new-branch-and-pr | `4e8f502fcf48553949387a9a7f58b21349e0ff87c24bf8ff5c0013e9da6819fd` | yes |

## On-disk closed count / 18

Pass pairs present under `parity/evidence/team-kit/pair-*.json` with `verdict: pass` and `closed_by_this_pair`:

1. `verify-this` (wave-001)
2. `check-compiler-errors` (wave-002 evidence on disk; no 002 report yet)
3. `deslop` (wave-002 evidence on disk; no 002 report yet)
4. `fix-merge-conflicts` (wave-002 evidence on disk; no 002 report yet)
5. `get-pr-comments` (this unit)
6. `make-pr-easy-to-review` (this unit)
7. `new-branch-and-pr` (this unit)

**Total closed from on-disk evidence: 7/18.**

## Still open (GitHub/CI-bound targets not closed here)

`fix-ci`, `loop-on-ci`, `pr-review-canvas`, `review-and-ship`, `run-smoke-tests`, `workflow-from-chats` remain open. `fix-ci` / `loop-on-ci` need a failing-check fixture iteration; none was run, so no green was claimed for those skills.

## Oracle checks (re-read)

Each closed skill has both sides with `STATUS=verified`, skill-path observation true, and skill-specific artifact oracle true (`FIXTURE_REVIEW_COMMENT` in summary, `FIXTURE_REVIEW_GUIDANCE` in PR body/notes, or live PR URL via `gh pr view`). Cursor used `--plugin-dir` for locked team-kit. Pi seeded matching `SKILL.md` bytes under `.pi/skills/<skill>/`. Real PTY screens under each attempt dir.

## Merge payload (coordinator)

```json
{
  "unresolvedReferenceAction": "keep_open",
  "skillsPairedCount": 7,
  "createSkillStyleFullClosureReady": false,
  "suggestedWaveNote": "u-dep-team-kit-journeys-003 closed get-pr-comments, make-pr-easy-to-review, and new-branch-and-pr via real PTY pairs against disposable just-joshn/team-kit-gh-fixture PR #1. On-disk pass pairs total 7/18. Keep unresolvedReference open."
}
```

## Acceptance

Met: three GitHub-bound skills closed with real PTY pairs; fixture PR URL recorded; total closed/18 taken from on-disk pass pairs only. Ledgers not edited. No fabricated CI.
