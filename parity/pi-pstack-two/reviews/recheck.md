# pi-pstack-two re-check after fixes

On this frozen tree, `bunx vitest run` in `extensions/pi-pstack-two` passes: 23 files, 203 tests, matching what you reported. I checked every Fixed row against its code and test. For the rows that point at a test, the test exercises the fixed behaviour and would fail without the fix, with one exception noted below (the mode path fix has no test). However, one fix introduced a regression, and one rebuttal does not hold in print and JSON runs.

## Confirmed defects

**1. Skill aliases and their `/` menu entries vanish when the package is installed through a symlinked path (medium; a regression from the architecture 6 fix).**
- **Where:** `src/aliases.ts:19` keeps a skill only if `command.sourceInfo.path` starts with `SKILLS_DIR`. `SKILLS_DIR` comes from `PACKAGE_ROOT`, which is built from `import.meta.url` (`src/paths.ts:6`). That URL is the resolved real path, while Pi records the skill path exactly as it was configured.
- **Probe:** I set the sandbox `settings.json` `packages` to a symlink pointing at the package. A second extension printed `getCommands()` and showed `sourceInfo.path = /private/tmp/…/pkglink/skills/ketchup/SKILL.md`.
  - `/ketchup now` stayed literal text.
  - With the real path, the same input expanded to `<skill name="ketchup"…`.
  - `/skill:ketchup` worked in both cases.
- **Scope:** Both the input handler and the autocomplete use `aliasTable` (`src/index.ts:77,79`), so CMD-001 and CMD-003 both fail for symlinked installs (dotfile-managed `~/.pi`, `npm link`, linked checkouts).
- **Why the tests miss it:** `test/aliases.test.ts:49` builds its fixtures from `SKILLS_DIR` itself, and the e2e sandbox uses the real path.
- **Fix:** compare canonical paths, for example `realpathSync` on both sides.

**2. In print and JSON runs, including every subagent, the `Loop` tool reports "Loop armed" and the loop never runs (medium-low).**
- **Where:** `loopToolText` (`src/loop.ts:130-145`) has no mode check. The `/loop` command does refuse these modes (`src/loop.ts:119`), and `decisions.md:134` states the invariant "never in print or JSON mode".
- **Probe:** `pi -p` with a scripted `Loop {prompt:"tick", interval:"1s"}` printed `Loop armed: "tick" every 1s; …` and exited 0. The child `@@tools-list` output above also shows `Loop` active in a JSON-mode subagent.
- **Impact:** A playbook that runs in a subagent, or in a `pi -p` overnight prompt, is told the loop is armed when it was silently dropped.
- **On the rebuttal:** The reconciliation refutes architecture 3 ("Loop is always active") on the grounds that the agent must be able to arm loops. That reasoning holds only where a loop can actually run.
- **Fix:** throw in one-shot modes, or deactivate the tool there as AskQuestion is.

**3. Dead code left behind by the architecture 6 fix (low).** `shippedSkillDescriptions` (`src/autocomplete.ts:11-19`) is no longer referenced anywhere in `src` or `test`. It still re-parses every `SKILL.md`, which is the duplicated discovery that fix was supposed to remove.

**4. The "mode stored an absolute skill path" fix has no test (low).** `src/mode.ts:75` (`tryResolve(stored.skill) ?? stored`) looks correct, but the reconciliation cites only the source file. No test moves the skill file and checks that restore finds it again by name; `test/mode.test.ts:51` covers only the "file is gone" message.

## Suspicions and questions

- **The run lock records the parent's pid, but the process that writes the transcript is the child** (`src/task/records.ts:53,58`).
  - If the parent is SIGKILLed, the orphaned child keeps writing for up to about 6 s (1 s watchdog plus 5 s exit, `src/index.ts:18-19,66`). Meanwhile another process sees a dead holder and takes the lock.
  - The takeover at `:58` is a plain overwrite, not an exclusive create, so two processes recovering the same stale lock can both acquire it.
  - If an unrelated process reuses the dead pid, every later resume is refused with "still running (pid N)", and the message does not say where the lock file is.
- **The `worktree-audit.sh` patch reads `sessionDir` only from the global `settings.json`** (`scripts/patches.json`). It does not expand `~`, which Pi's `normalizePath` does, and it ignores a project-level `.pi/settings.json`. I did not test either case.
- **"Agents never cross workspaces" holds only as far as Pi's folder naming does.** `workspaceSlug` (`src/paths.ts:21-25`) maps `/a-b/c` and `/a/b-c` to the same folder, so those two workspaces share records and can resume each other's agents. This mirrors Pi's own session folders, so it may be acceptable, but it is not stated.
- **A subagent could lose its depth if the extension is ever re-evaluated.** `src/child-env.ts` deletes the `PI_PSTACK_TWO_*` variables at module load, and Pi loads extensions with `moduleCache: false` (`dist/core/extensions/loader.js:478`). A reload or new session inside a subagent would reset depth to 0 and drop the parent watchdog. I found no normal path that does this in JSON mode, so I have not confirmed it.
- **A fresh agent's record is written before an asynchronous spawn failure** (for example ENOENT on `pi`; `src/task/tool.ts:171-172`). The resulting record has no transcript, and resume would accept its ID. This is minor.
- **Refuted and Recorded rows I accept:**
  - "No stop or message channel" is refuted by F1, which is a fair argument.
  - "Session-folder naming is documented": `docs/session-format.md:8-14` confirms it.
  - The print-mode settle hold, `piCommand`, and the copied skill-block shape are reasonable to record as known limitations.

## Overall assessment

The fixes are mostly real and well tested. The todo restore, the `-fast` and colon model lookups, the 24-day cap, the abort-stops-loop path, the readonly floor, the attachment-before-record order, environment scrubbing, the parent watchdog, and same-message resume exclusivity all have tests that would fail without the change. I also checked the rule guard against Pi's `resolveToCwd` and found it matches in order and scope. The main problem is a new one: the switch to `pi.getCommands()` for aliases compares a real path against a configured path, so symlinked installs lose `/name` commands and their menu entries. That is the item I would fix before shipping. The `Loop` tool should also refuse, or be withdrawn, in print and JSON modes so it matches the `/loop` command and `decisions.md`. The rest are low-severity cleanups or edge cases.
