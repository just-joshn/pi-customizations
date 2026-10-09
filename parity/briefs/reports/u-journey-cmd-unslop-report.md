# u-journey-cmd-unslop report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, honest host deltas). Both hosts activated `/unslop` and rewrote `draft.md` in place. Listed AI-tell pattern count dropped 31 to 0 on each side. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `f365bb05-6976-45a4-a821-24fd7294247f` |
| pi | `17fc084a-37e9-44c4-bf62-9149cf6cc9ba` |

Pair. `parity/evidence/unslop/pair-unslop-process-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Unslop process on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | FS poll rewrote `draft.md` at `2026-10-08T21:27:18.677Z`. Before digest `9d014635…`, after `7496339f…`. Pattern scan 31→0. Snapshots at `cursor/draft-before.md` and `cursor/draft-after.md`. `done.txt` line `draft.md unslop rewrite applied`. |
| pi | **yes** | FS poll at `2026-10-08T21:27:45.631Z`. Session `01a11d6a…` injected package `unslop` SKILL.md, then rewrote `draft.md`. Before digest `9d014635…`, after `ca69f2ee…`. Pattern scan 31→0. `done.txt` under prompted `fixture-out/pi/`. |

Worker capture playbook. `parity/evidence/unslop/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Wrote worker `PLAYBOOK.md`, fixture-app (sloppy `draft.md`), then `parity/scripts/capture-unslop-process.mjs`.
3. `node parity/scripts/capture-unslop-process.mjs --cursor-only` (~44s).
4. `node parity/scripts/capture-unslop-process.mjs --pi-only` (~20s).
5. Re-read screens, poll logs, before/after drafts, Pi session skill block.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. After digests differ between hosts (`7496339f…` vs `ca69f2ee…`). Both are clean rewrites of the same baseline. Wording is not byte-identical.
3. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or family stubs.
4. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-05 / `cmd-unslop-process` evidence when ready.
2. Optionally note that prose equality across hosts is not required when tell-count drop and skill activation already pass the process requirement.
