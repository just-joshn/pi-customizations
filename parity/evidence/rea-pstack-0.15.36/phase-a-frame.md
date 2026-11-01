# Phase A frame — pi-pstack ↔ pstack 0.15.36

## Goal
`extensions/pi-pstack` matches Cursor plugin `pstack` 0.15.36 (plus the `cursor-team-kit` skills poteto-mode soft-depends on) for every user-visible workflow, in Pi-native mechanisms only, with zero install or runtime dependency on the Cursor `pstack` plugin.

## Done predicate (falsifiable)
A re-runnable gate reports PASS only when all of the following hold:

1. **Inventory lock.** Tip `cursor/plugins` revision and installed cache hashes for `pstack` 0.15.36 and `cursor-team-kit` 1.2.0 are recorded; every skill, agent, automation, guide page, and executable script tree is listed.
2. **No pstack dependency.** `extensions/pi-pstack/package.json` and install docs never require installing Cursor `pstack`; tests assert absence of upstream-sync machinery (`resources.test.ts` already checks this).
3. **Skill/agent/automation coverage.** Every tip pstack path and every referenced team-kit skill has a Pi package counterpart; text follows `parity/pi-pstack-0.15.36/design.md` vocabulary (Pi names, not Cursor host names).
4. **Host feature coverage.** Every host capability skills call by name has a Pi implementation under `extensions/pi-pstack/src` (Task/fork/resume/status, TodoWrite, AskQuestion, mode, plan, loop, subscriptions/routines, visualize, model rule, stores/projects) with package tests green.
5. **Executable parity.** poteto-mode scripts (watch-pr, check-plan, bootstrap, worktree-audit) and statechart scripts behave on Pi as on Cursor (existing script tests + REA-grounded entrypoint inventory).
6. **Behavioral gate.** Package `bun run test` / `typecheck` pass; any previously open user-visible mismatch is closed or has a Pi-native substitute documented and tested.
7. **Out-of-scope disposition.** Cursor-platform-only edges (cloud Computer Use attempt IDs, Enterprise org policy witnessing) are recorded as `cursor-platform-out-of-scope-with-pi-substitute`, not as completion blockers for plugin parity.

## Scope (measured)
- Tip clone `/tmp/cursor-plugins-rea` @ `ae5650febf4320793844c12c4adaa937f417f8da` (pstack tree unchanged since `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`), pstack **0.15.36**, team-kit **1.2.0**.
- Installed cache matches version 0.15.36 (~574 files).
- Package `@justjoshn/pi-pstack@0.15.36-pi.4` vendors pstack skills + team-kit skills; durable supervisor auto-starts on subscribe; host extension exists; prior ledger had 98/98 paired requirements for an older 0.15.15-era gate that still BLOCKED on Cursor-platform edges.
- SKILL.md byte equality vs cache: 38 same, 20 Pi-translated diffs, 0 missing, 21 extra (team-kit + create-skill set).
- REA: poteto-mode scripts 13 JS files parsed; statechart scripts 48 JS files parsed; evidence bundle at `parity/evidence/rea-pstack-0.15.36/evidence-bundle.json`.

## Rigor
High. Host-feature mapping and "no Cursor dependency" are one-way doors for the package contract. Skill text translation is reversible. Prefer levers (inventory scripts, resource tests) over hand diffs.

## Tradeoffs
- Prior completion gate demanded witnessing Cursor CU cloud + Enterprise. That conflates platform with plugin. This frame rejects that premise for the done predicate while still documenting those edges as out-of-scope with Pi substitutes (local isolated workers, Pi MCP/policy story).
- "100% parity" means user-visible pstack+soft-dep behavior on Pi, not bit-identical Cursor IDE chrome.
