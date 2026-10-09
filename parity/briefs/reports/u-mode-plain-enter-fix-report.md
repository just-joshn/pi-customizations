# u-mode-plain-enter-fix report

## Status

Repaired. Plain `/poteto-mode <task>` matches Cursor plain Enter (skill for one message, no sticky crown). Sticky entry is explicit `/poteto-mode sticky` / `/poteto-mode sticky <task>` (same on `/skill:poteto-mode sticky`). Ledgers untouched. No commit.

## Sticky spelling chosen

`/poteto-mode sticky` alone and `/poteto-mode sticky <task>`. Case-insensitive `sticky` token. Same on `/skill:poteto-mode sticky…`. `/poteto-mode off` unchanged.

## Root cause

`registerCommands` and `registerNativeInput` called `store.toggle(true)` on every non-off `/poteto-mode` and `/skill:poteto-mode`. That inverted the Cursor oracle (Enter = one message; sticky = separate entry).

## Fix

`parseModeArgs` / `applyModeArgs` in `extensions/pi-pstack/src/commands.ts`. Only `sticky` toggles on. Plain and skill paths deliver the skill body without enabling session mode. poteto-help and guide page 2 state the Pi mapping without Cursor Option+Enter / Custom Mode chrome strings.

## Test results

```
cd extensions/pi-pstack && bunx vitest run test/commands.test.ts test/parity-runtime-mode.test.ts
# 15 passed

cd extensions/pi-pstack && bun run typecheck
# ok

# Also green after updating dependents:
# test/integration.test.ts, test/user-perspective.test.ts,
# test/first-action-rule.test.ts, test/latest-workflows.test.ts
# (78 passed across those six files with commands + parity-runtime-mode)
```

TDD. Commands tests first expected `enabled === false` on plain task and sticky delivery without the `sticky` token in the task. Both failed on the old code for those reasons. Green after the parse change.

## Test files updated

- `extensions/pi-pstack/test/commands.test.ts`
- `extensions/pi-pstack/test/parity-runtime-mode.test.ts`
- `extensions/pi-pstack/test/integration.test.ts`
- `extensions/pi-pstack/test/user-perspective.test.ts`
- `extensions/pi-pstack/test/first-action-rule.test.ts`
- `extensions/pi-pstack/test/latest-workflows.test.ts`

## Docs / help updated

- `extensions/pi-pstack/skills/poteto-help/SKILL.md`
- `extensions/pi-pstack/prompts/poteto-help.md` (kept in sync with skill body)
- `extensions/pi-pstack/docs/guide/02-poteto-mode.md`
- `parity/scripts/capture-mode-one-message.mjs` (comment only)

## Recapture

| Field | Value |
| --- | --- |
| attempt id | `f19e11c7-b1e5-4788-9f04-bb0e5c9de559` |
| command | `node parity/scripts/capture-mode-one-message.mjs --pi-only` |
| `piStickyBadge` after plain enter | false |
| `piStickyBadge` after first turn | false |
| `piStickyBadge` after second turn | false |
| skill block | `[skill] poteto-mode` on first turn (`screen-05-after-second-turn.txt`) |
| replies | `one message only` then `4` on screen |
| pair | `parity/evidence/mode-one-message/pair-mode-one-message-1.json` (Pi side supersedes `bb7c8cd9-…`) |

## Principles applied

- **redesign-from-first-principles.** One-message is the default command path. Sticky is an explicit invocation kind, not a bolt-on after toggle. Docs and tests follow that split.
- **test-behavior-not-implementation.** Asserts `store.read().enabled`, delivered skill text, and sticky section presence across a follow-up. Not mock call counts alone.
- **prove-it-works.** Unit green, then PTY recapture with `piStickyBadge: false` after plain `/poteto-mode` + follow-up.

## Playbook notes

Bug-fix step 6 (Opening a PR) skipped. Brief forbids commit. Step 5 commits skipped for the same reason. TDD still ran fail-then-fix in the working tree.
