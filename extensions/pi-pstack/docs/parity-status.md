# Parity status

This page lists, for pi-pstack 0.15.36-pi.40, which parts of the specification have a passing test and which do not. The specification is `parity/pi-native-tmux-2026-11-11/specification.md` at the repository root. A row is "proven" only when the named test exercises it. Everything else is "partial" or "unverified", and the row says why.

## Source pin

- Upstream: `github.com/cursor/plugins` at `5866df557357d005b3c0c9d3da0d9e739b4bdde3`, paths `pstack/` and `cursor-team-kit/`. `generated/upstream-lock.json` holds the checksum of every vendored file.
- pstack's last change at that commit is `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`, recorded in `package.json` `pstackSource`.
- `node scripts/check-parity.mjs` reports 62 skills (34 primary, 24 principle, 4 team-kit), 23 playbooks, 3 worker roles, 62 prompts, 179 rules, and 244 spans.

## Run the checks

From the repository root:

```sh
sh parity/pi-native-tmux-2026-11-11/regen.sh       # recompile, check parity and dependencies, rebuild dist/
sh parity/pi-native-tmux-2026-11-11/merge-gate.sh  # tsc and the full Vitest suite
```

`git status` must be clean after `regen.sh`. `tests/integration/pi-load.test.ts` runs the real Pi binary, `/Users/josh-desktop/.pi/agent/bin/pi` unless `PSTACK_E2E_PI` names another.

## Status by requirement

| Requirement (spec section) | Status | Evidence |
| --- | --- | --- |
| Package loads in Pi with its skills, prompts, `/pstack`, and only the two pstack tools (16.2 Native package) | Proven | `tests/integration/pi-load.test.ts` |
| `pi install` of a copy without `node_modules` (18) | Proven | `tests/integration/pi-load.test.ts` |
| npm pack ships `src/`, `scripts/`, `generated/`, `vendor/`, and `dist/`, and nothing of the removed runtime | Proven | `tests/packaging/package.test.ts` |
| Stale `dist/` bundles fail `npm pack` | Proven for `dist/watch-pr.js` and `dist/worker-host.js` | `tests/packaging/helper-pack.test.ts` |
| Every upstream skill, playbook, and reference compiles, with every change recorded (6, 16.1) | Proven | `tests/skill-parity/inventory.test.ts`, `references.test.ts`, `spans.test.ts`, `regeneration.test.ts` |
| An upstream change or an unmapped Cursor primitive fails the build (16.2 Source upgrade) | Proven | `tests/skill-parity/gates.test.ts` |
| Every skill by its original `/name`, with `/pstack:<name>` for a conflict (8.2) | Proven | `tests/skill-parity/slash-routing.test.ts`, `tests/integration/pi-load.test.ts` |
| Persistent style with compaction, resume, and fork (8.3) | Proven | `tests/integration/extension.test.ts` |
| `/pstack` subcommands (8.3) | Proven | `tests/integration/commands.test.ts` |
| `TODO.md` copies every playbook step in order (11.1) | Proven | `tests/todo/start-run.test.ts` |
| Worker spawn, steer, abort, collect, and single-writer claims (9) | Proven | `tests/worker-lifecycle/lifecycle.test.ts`, `spawn-outcome.test.ts`, `abandon.test.ts` |
| A settle covers only acknowledged work; no false completion (9.3) | Proven | `tests/worker-lifecycle/settle-coverage.test.ts`, `settle-liveness.test.ts` |
| Parent restart reconciles workers and delivers each wake once (9.5) | Proven | `tests/recovery/recovery.test.ts` |
| Sub-coordinators for Orchestrate, three levels deep | Proven | `tests/worker-lifecycle/nested-spawn.test.ts`, `spawn-depth.test.ts` |
| Worker environment and capability boundary (15.1) | Partial: same uid, see Known gaps | `tests/worker-lifecycle/env-snapshot.test.ts`, `tests/automation/automation.test.ts` ("worker inputs") |
| Evidence receipts and verification (7, 8.4) | Proven | `tests/worker-lifecycle/evidence.test.ts`, `evidence-link.test.ts` |
| Model roles, budgets, fallback, and inheritance (10.3) | Proven | `tests/model-routing/models.test.ts`, `tests/integration/extension.test.ts` ("roleModelResolver") |
| Forge resolution and watch-pr (13.1) | Proven | `tests/forge/forge.test.ts`, `tests/helpers/watch-pr-differential.test.ts` |
| Upstream helpers: `check-plan`, `log.sh`, `worktree-audit.sh`, watch-pr (12.6) | Proven | `tests/helpers/generated-helpers.test.ts`, `tests/helpers/scripts.test.ts` |
| Statechart compiler | Proven from a checkout. Not proven for npm installs. | `bun run test:statechart`, `tests/packaging/installed-helpers.test.ts` |
| Benny: redelivery, outbox crash recovery, fail-closed prerequisites (14) | Partial: no tracker or control adapter | `tests/automation/automation.test.ts`, `tests/automation/parity.test.ts` |
| Webhook routines (14.4) | Proven | `tests/automation/routine.test.ts`, `tests/automation/automation-command.test.ts` |
| Readonly shell sandbox (15.1) | Code proven. Not wired to readonly workers. | `tests/security/` |
| Container workers (9.6, 15.1) | Missing | none |
| MCP and Codemode (10) | Unverified: Pi's own features, no pstack test | none |
| Print and JSON modes (16.2 Headless operation) | Unverified: the load test uses RPC mode | none |
| Workflow families end to end: arena, swarm, Babysit, Shipping (12, 13) | Unverified: no scripted end-to-end run | none |

## Known gaps

- **Container workers.** `parseAssignment` in `src/run-files.ts` accepts only `worktree` and `readonly` workspaces. The compiled Shipping and Autopilot-full playbooks ask for `workspace: { mode: "container" }` and expect `ContainerUnavailable`. Today the parser rejects the assignment with a different message.
- **Same-uid credentials.** A worker runs as the operator's user and can read any file that user can read. The capability boundary removes tools and environment variables, not file access.
- **Readonly shell.** `bash_readonly` is not registered for readonly workers yet. They get `read`, `grep`, `find`, and `ls` (`READONLY_TOOLS` in `src/workers.ts`).
- **Statechart from npm.** `generated/skills/statechart/scripts/statechart` runs `statechart.ts`. Node refuses to strip types under `node_modules`, so an npm install cannot run it on Node. The removed `skills/` copy ran a bundled `statechart.js`. `tests/packaging/installed-helpers.test.ts` marks the case `test.fails`.
- **Benny pack text.** `automations/benny/` still tells the agent to create automations with `/automate`, `/automations`, and `environment: "cloud"`, which this package no longer has. `scripts/benny-setup.mjs` copies that pack into a project.
- **Benny cases.** No tracker or control adapter ships, so a case that needs one is logged `blocked`.
- **Mid-message skill names.** A `/name` later in a message no longer attaches its skill. Only a `/name` at the start expands.
- **Bugbot.** No replacement.

## Removed with the old runtime

pi-pstack 0.15.36-pi.40 deleted the runtime of 0.15.36-pi.39 and its tests. `git show c59cdbbf` lists each deleted test and the module it covered. `git show 3bbdca7b` lists the deleted source.
