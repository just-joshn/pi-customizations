# Review context: pi-pstack-two, round 2

You are reviewing a port of the Cursor plugin pstack 0.15.20 (cursor/plugins@1b6d44f, MIT) and its named dependencies to Pi 1.1.0, as the Pi package `extensions/pi-pstack-two` in the repository at the current working directory. You share no context with the author. This is a read-only review: do not edit, create, or delete files in the repository, and do not commit. You may read files, search, and run read-only commands, including the test suite (its sandboxes live under the system temp directory).

Read first:
- `parity/pi-pstack-two/spec.md` (requirements with IDs and evidence)
- `parity/pi-pstack-two/decisions.md` (designs considered and chosen, Pi API citations, the native-gap gate)
- `parity/pi-pstack-two/ledger.json` (status per requirement; the validator derives the verdict)
- `parity/pi-pstack-two/evidence/live-summary.md` and `evidence/tui-smoke.md`
- `parity/pi-pstack-two/reviews/recheck.md` (round-1 findings this round claims to fix) and `reviews/reconciliation.md`
- `extensions/pi-pstack-two/README.md`
- `extensions/AGENTS.md` (the repository's Pi-native-first rules and hard bans)

Code under review (all new, untracked): `extensions/pi-pstack-two/src/**`, `extensions/pi-pstack-two/test/**`, `extensions/pi-pstack-two/scripts/sync-upstream.mjs`, `scripts/patches.json`, `scripts/live-e2e.mjs`, `skills/create-skill/SKILL.md` (authored). Everything else under `extensions/pi-pstack-two/skills`, `agents`, `docs/guide`, `automations`, and `licenses` is generated from upstream and pinned by `upstream.lock.json`; `skills/poteto-mode/scripts/worktree-audit.sh` carries the one declared patch.

Changes since round 1:
- Resynced from 0.15.17 (`11713c6`) to 0.15.20 (`1b6d44f`, upstream `main`): the `Comment Sicko` agent id became `comment-sicko`, `poteto-agent` became a delegate, `worktree-audit.sh` gained `-b <base>`, upstream's test script added `check-plan.test.ts`, `ketchup` asks for generated images.
- Recheck fixes: aliases and the `/` menu match package skills by canonical path (symlinked installs); `Loop` is withdrawn and refused in print and JSON runs (subagents) and the host map's `/loop` line depends on the mode; dead `shippedSkillDescriptions` removed; the run lock names the child pid once it starts, fails closed on an unreadable lock, re-reads before a stale takeover, and only releases a lock it still owns; a fresh agent's record is written only after its child starts; `worktree-audit.sh` finds custom session folders as Pi does (env, project over agent settings, `~`, relative paths).
- New HOST-008 host-map line mapping Cursor tool names (`Read`, `Grep`, `Glob`, `Shell`); `src/modes.ts` holds the shared one-shot predicate.
- `test/e2e/harness.ts` honors `PSTACK_TWO_E2E_PI=<pi executable>` to run the e2e suite against an installed Pi.

Results the author reports on the final revision (all run this session):
- `npx vitest run` in the package: 23 files, 218 tests passed. With `PSTACK_TWO_E2E_PI=~/.pi/agent/bin/pi` (the user's installed launcher), the 8 e2e files (51 tests) also passed; with a nonexistent path they fail, so the switch is honored.
- Mutation checks: removing the parent watchdog, the abort listener, `holdFor`, or the canonical-path match each fails its test; removing the shutdown kill fails both lifecycle tests, while the quit test still passes because the orphan watchdog also ends the child.
- `tsc --noEmit`, `biome check`, the repo's agents-compliance, vitest-convention, Pi-mechanism, toolchain, and type-policy checks: clean (advisory notes only).
- `node scripts/sync-upstream.mjs --check --source <cursor/plugins clone at 1b6d44f>`: 166 files match.
- Real-model runs with deepseek-flash on 0.15.20 and a tmux TUI run with the installed `pi`: see `evidence/live-summary.md` and `evidence/tui-smoke.md`.
- Ledger validator: NOT VERIFIED (VERIFIED 50, NOT VERIFIED 1, INCONCLUSIVE 4, NOT APPLICABLE 7).
- Pi 1.1.0 docs and declarations are installed under `extensions/pi-pstack-two/node_modules/@earendil-works/pi-coding-agent/` (`docs/`, `dist/**/*.d.ts`). An upstream clone at `1b6d44f` is at `/tmp/pstack2-src`.

Output format. Write Markdown with two sections: "Confirmed defects" (each with file path and line, the evidence you checked, and severity high/medium/low) and "Suspicions and questions" (things you could not confirm). End with a one-paragraph overall assessment. Cite paths and line numbers. Do not pad the report; an empty section is fine.
