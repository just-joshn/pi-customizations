Focus: recheck the round-2 fixes.

Since `context-r2.md` was written, the author changed the tree to address the three round-2 reviews (`parity-r2.md`, `security-r2.md`, `architecture-r2.md`) and recorded a disposition for every finding in `reviews/reconciliation-r2.md`. Current results the author reports: `npx vitest run` in the package passes 24 files and 251 tests; the e2e files also pass with `PSTACK_TWO_E2E_PI=~/.pi/agent/bin/pi`; `tsc`, `biome check`, and the repo's agents, vitest-convention, Pi-mechanism, toolchain, and type-policy checks are clean; the ledger validator derives NOT VERIFIED (VERIFIED 51, NOT VERIFIED 2, INCONCLUSIVE 4, NOT APPLICABLE 7).

For every row of `reconciliation-r2.md`:
- Check a Fixed row against the code and its test. Would the test fail without the fix?
- Check a Refuted or Recorded row against the evidence it cites.
- Hunt for regressions the fixes introduced, especially in these areas:
  - aliases now cover every loaded skill (`src/aliases.ts`), and the host list uses `packageSkillNames`;
  - modes store only a skill name (`src/mode.ts`);
  - model levels are validated with `getSupportedThinkingLevels` (`src/task/models.ts`), and what that means for the rule values `/setup-pstack` writes;
  - usage is summed from `toolResult` and `compaction_end` events (`src/task/runner.ts`), with any risk of double counting;
  - agent depth is stored in the record and children pass `--approve`/`--no-approve` (`src/task/tool.ts`);
  - `bounded` now uses `truncateHead` (`src/task/format.ts`);
  - the watchdog checks `process.ppid` (`src/index.ts`);
  - the rule guard canonicalizes through the nearest existing ancestor (`src/rule.ts`);
  - the `worktree-audit.sh` patch (`scripts/patches.json`).
- Confirm that the ledger rows, `spec.md`, `decisions.md`, and the README describe the code as it now is.

Separate confirmed defects from suspicions, and cite file paths and line numbers.
