# Software architecture reconstruction: pstack 0.15.36 and dependencies

## Goal

Reconstruct the software architecture of the upstream Cursor plugin `pstack` (`https://github.com/cursor/plugins/tree/main/pstack`, version `0.15.36`) and all of its dependencies using the REA MCP server, then map every upstream capability and dependency to Pi's native extension mechanisms in `extensions/pi-pstack`.

## Sources and REA evidence ledger

All static analyses below were produced in this session by `REA JavaScript application analyzer` (`rea-javascript-application` v1), `REA analysis view projection` (`rea-analysis-view` v1), and `REA JavaScript application workflows` (`rea-javascript-application-workflows` v1). Every claim separates static observations from static inferences and residual unknowns.

| Target | Path | Format | Root SHA-256 | Parent Evidence ID | Summary / View Evidence ID | Files / JS parsed |
| --- | --- | --- | --- | --- | --- | --- |
| Upstream `pstack/skills/poteto-mode/scripts` (clean cache) | `~/.cursor/plugins/cache/cursor-public/pstack/1ba91fc25c0977741dd0e267849e6234b037ed0a/skills/poteto-mode/scripts` | directory | `ab08fdd851002bfdd61fcc3c902bf0e6bb2bbd4b0229b5443e30626e3a788e07` | `ev_bf12ac9c3d463df579c1009ce80a874431c3cc14c168a783114077161d704139` | `ev_5cb366a2d252413ad6fc6350f1644aab7f751bfcfdd86e8af41a18851c99ac29`, `ev_f9e9795252c5470742dd90329b7bc1198882f4f5138e369cadb6a0397a0f5ee0`, `ev_5935daf21a6e6160681b399f1cc7482596cfedd3a7494c859a0e369fa6b0a946` | 15 relevant, 13 JS/TS parsed, 0 failures |
| Upstream `pstack/skills/poteto-mode/scripts` (with `node_modules`) | `/Users/josh-desktop/src/experiments/plugins/pstack/skills/poteto-mode/scripts` | directory | `5b92deccc760dacf7f0f5278c2c4ecff34b98d87fc70f04fecc2210fcc52980c` | `ev_d6ff54533e36b7719f1b6e18031ee2521ff4368bdabe87f34372f46a1760c3e8` | retained in bundle | Includes `commander@14.0.0` and `typescript@7.0.2` |
| Upstream `pstack/skills/statechart/scripts` | `~/.cursor/plugins/cache/cursor-public/pstack/1ba91fc25c0977741dd0e267849e6234b037ed0a/skills/statechart/scripts` | directory | `2193bf21071d9a8d176d142c5aa0d3257c98de4689e948e21b20957f83616e33` | `ev_5068b39b821b4f8848661475ed4d4e141343d183785cd0d1f48cc4c560700b24` | `ev_ce9ee247f111b881d6c100242cfa0560623e65b11248377553e053fb8b6f62f3`, `ev_bd7036ccd42e670602201871d0feba62dfffde58a1e942edcf879019555c25d2` | 50 relevant, 48 JS/TS parsed, 0 failures |
| Upstream `cursor-team-kit/skills/pr-review-canvas` | `/Users/josh-desktop/src/experiments/plugins/cursor-team-kit/skills/pr-review-canvas` | directory | `2666f69c5a27cb4256a403747f8606c55d68b7ab28556d7f0d3fe6fe359f9b3a` | `ev_2c98abedf7c1c05212d64174a87f0039f79218f72f4b0f1def35f6f3c2327ac9` | `ev_d63a021f7e544b9403b2a48e25bebe7ad59220b82aa1378ffed159e559c2da19`, `ev_2c3f2ede73725fa0fa715e3992b851b3e526d2df85d8e1ef1de50752d04bf93d` | 2 relevant, 1 JS parsed (`renderer.js`), 0 failures |
| `extensions/pi-pstack/src` | `extensions/pi-pstack/src` | directory | `ebb60ef861603834b12d5f9a45f4108759d8c29d0605b38e07560456c0605ce8` | `ev_6fe43d2bbfab36c6763a2d1e940ee728fdbbe2ad2abb9162f70c102ccab8860f` | `ev_f5ea22bb2d470f8108ea52961fdbd0f8411142176ac7db78b0bdeca4c0f0e37e`, `ev_16b3d7080fa763f288e7e5a8291873a3bb1130fd1ad6be06070d51e7d753b71b` | 36 relevant, 36 TS parsed, 0 failures |
| `extensions/pi-pstack/skills/statechart/scripts` | `extensions/pi-pstack/skills/statechart/scripts` | directory | `9b47d92dbdc42204b53f020bdc7f802b6f5fff6220ecbe164dcf263906f2f914` | `ev_a8c8d7db63d2519d306e47d6d724a5119b28a1049a9eddbd73ea6f29dbc94caf` | `ev_1091007aca08202f865c78a8dd7452fa09d54fa0dcb807428f4d5c38732cb39f` | 50 relevant, 48 JS/TS parsed, 0 failures |
| `extensions/pi-pstack/skills/pr-review-canvas` | `extensions/pi-pstack/skills/pr-review-canvas` | directory | `2666f69c5a27cb4256a403747f8606c55d68b7ab28556d7f0d3fe6fe359f9b3a` | `ev_e2dd5f48359956b83e32cdf0ac784c770cb97673cf712a4aaf490a27ecc1e8db` | `ev_12653e2b69c57038367443acf5635729793344211a0a13ef80a5c3dfdb1c376f` | 2 relevant, 1 JS parsed, 0 failures |

### Focused module item and trace Evidence IDs

- `bootstrap.ts` module item view: `ev_76dece32cf003cb0c2ba0994d5c886d5ff51b2c4dbeabc63e1b01fd5f4df0f42`
- `check-plan.mjs` module item view: `ev_d8b696f0eebbd0ee8619cb4a70bcfcec7d85d8f7c397a717799db1217e7ec99b`
- `statechart/scripts/run.ts` module item view: `ev_e43256ff8736be8e4ab9dc0a065c5acc134048f557bf3a9bd0b78ce537a1bc1b`
- `pr-review-canvas/renderer.js` module item view: `ev_161a445223f452c7cc7f3104399476f625137fc93a3fc5fe4b9bd485742185c4`
- Outgoing feature trace on `watch-pr/github.ts`: `ev_47b1b4f41568acc919b7b99f7b18014ab564745436bfc493d9bf88ad56f15f29` (18 matched seeds, 27 traced nodes, 28 traced edges, 27 observed facts, 43 inferred facts)
- Outgoing feature trace on `statechart/scripts/run.ts`: `ev_b2c06c4cca93538bcb8b18f0570627f9149c127b69b3055b7a4d174dca19e6fd` (7 matched seeds, 115 traced nodes, 194 traced edges, 114 observed facts, 258 inferred facts)
- Outgoing feature trace on `extensions/pi-pstack/src/index.ts`: `ev_22556088c77e2fa9073d079a7ed0796b2545e2f36a6223d130b2df64a8b04d12` (3 matched seeds, 372 traced nodes, 558 traced edges, 271 observed facts, 849 inferred facts)
- Version comparison for `statechart/scripts` (upstream vs `pi-pstack`): `ev_a220a808b81c474aaaa62752f324f54976d47a43ccc4e7100da1cff2b4c470a4` (`changed: 1`, `added: 0`, `removed: 0`, where the single changed node is `package.json` name `@cursor-skill/statechart-scripts` to `@pi-pstack/statechart-scripts`)
- Version comparison for `pr-review-canvas` (upstream vs `pi-pstack`): `ev_1066025d4b0edd77d4d50a798a4cd11b3581a601509962224fa04546d55d549d` (`changed: 0`, `added: 0`, `removed: 0`, byte-identical SHA-256 `2666f69c5a27cb4256a403747f8606c55d68b7ab28556d7f0d3fe6fe359f9b3a`)

## Architecture of upstream pstack 0.15.36

Upstream `pstack` (`plugin.json` version `0.15.36`, author Lauren Tan) is an agent workflow plugin composed of five structural layers:

1. **Manifest layer (`.cursor-plugin/plugin.json` and `plugin.json`)**:
   - Declares plugin identity (`name: "pstack"`, `version: "0.15.36"`, schema `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`).
   - Exposes conventional directories: `skills/` (58 skill directories), `agents/` (2 subagent definitions), `automations/benny/` (autonomous issue triage and reproduction pack), and `docs/guide/` (10 guide chapters plus `README.md`).
2. **Orchestrator and playbook layer (`skills/poteto-mode/`)**:
   - `skills/poteto-mode/SKILL.md` is the root dispatcher. It defines non-negotiable triggers, the 23-entry Principles index, autonomy rules, subagent model routing, reply and comment rules, and the 22-playbook router (`playbooks/*.md`).
   - Note on `orch.ts`: commit `c742dd6` (`feat(pstack): make Orchestrate agentic and delete the orch scripts (#1043)`) deleted `skills/poteto-mode/scripts/orch/`. `playbooks/orchestrate.md` now coordinates multi-PR programs directly through `Task`, a shared `Project` folder (`notes.md` + `store/`), and PR/timer subscriptions.
3. **Routed workflow and principle skills (`skills/*/`)**:
   - 23 leaf principle skills (`principle-*`) loaded on demand when a trigger matches.
   - Multi-agent routed workflow skills: `how` (explorer + explainer subagents), `why` (git-history investigators + synthesizer), `architect` (parallel interface sketchers + synthesis), `arena` (competing implementations + cross-judge), `swarm` (partitioned coverage/gauntlet workers), `interrogate` (adversarial multi-model review), `reflect` (tooling + judgment + divergent reviewers + synthesizer), `figure-it-out` (hypothesis-loop playbook builder), `show-me-your-work` (append-only TSV decision trail), `statechart` (TLA+ model checking + ASCII/HTML statechart compiler), `ketchup` and `ketchup-video` (work catch-up summaries and narrated slide videos), `setup-pstack` (model rule generator), `automate-me` (transcript-mined personal mode generator), `make-bot-ui` (webhook-backed action UI), `no-comments`, `unslop`, `technical-writing`, `typescript-best-practices`, `tdd`, `sharpen`, `blast-radius`, `correct`, `teach`, `recall`, `bro`, `in-your-own-words`, `poteto-help`, `benchmark-checklist`, `create-verification-skill`, `maintain-verification-skill`, `create-formal-verification-skill`, and `maintain-formal-verification-skill`.
4. **Subagent definitions (`agents/`)**:
   - `agents/poteto-agent.md`: background code-writing delegate (`is_background: true`) that reads `poteto-mode/SKILL.md` before executing its assigned scope.
   - `agents/comment-sicko.md`: foreground comment-deletion and workaround-flagging agent spawned by `/no-comments`.
5. **Executable script packages**:
   - `skills/poteto-mode/scripts/` (`ev_bf12ac9c3d463df579c1009ce80a874431c3cc14c168a783114077161d704139`):
     - `bootstrap.ts` (`ev_76dece32cf003cb0c2ba0994d5c886d5ff51b2c4dbeabc63e1b01fd5f4df0f42`): checks whether `node_modules/commander` exists; if missing, runs `bun install --frozen-lockfile` in `import.meta.dir` via `Bun.spawnSync` and re-execs the entrypoint.
     - `watch-pr/` (`cli.ts`, `github.ts`, `policy.ts`, `render.ts`, `types.ts`): CLI built on `commander@14.0.0` that polls GitHub PR state, review threads (`REVIEW_THREADS_QUERY` GraphQL query at `watch-pr/github.ts:4`), check runs, and mergeability by spawning `gh` (`ev_47b1b4f41568acc919b7b99f7b18014ab564745436bfc493d9bf88ad56f15f29`, 3 child-process relations observed).
     - `check-plan.mjs` (`ev_d8b696f0eebbd0ee8619cb4a70bcfcec7d85d8f7c397a717799db1217e7ec99b`): standalone Node ESM script (`node:fs`, `node:process`, zero npm dependencies) that validates multi-phase plan Markdown structure.
     - `worktree-audit.sh`: bash script using `git`, `rg`, `jq`, and BSD/GNU `stat`/`date` to classify git worktrees against recent transcript activity.
   - `skills/statechart/scripts/` (`ev_5068b39b821b4f8848661475ed4d4e141343d183785cd0d1f48cc4c560700b24`):
     - `statechart` shell wrapper and `statechart.ts` CLI entrypoint, `worker.ts`, `pipeline.ts`, `ir.ts`, `run.ts` (`ev_e43256ff8736be8e4ab9dc0a065c5acc134048f557bf3a9bd0b78ce537a1bc1b`), `frontends/` (`spec.ts`, `config.ts`, `trace.ts`, `value.ts`, `marks.ts`, `messages.ts`), `passes/` (`annotate.ts`, `label.ts`, `paths.ts`, `regions.ts`), and `backends/` (`cfg.ts`, `report.ts`).
     - `run.ts` (`ev_b2c06c4cca93538bcb8b18f0570627f9149c127b69b3055b7a4d174dca19e6fd`, 26 child-process relations across the tree) resolves Java (`java@temurin-25` via `mise` or `JAVA`) and `tla2tools.jar` (`TLA2TOOLS`), runs `tlc2.TLC`, parses state graphs and counterexample traces into `ir.ts`, and renders terminal/SVG/HTML statecharts.
   - `skills/show-me-your-work/scripts/log.sh`: POSIX shell helper that appends ISO-8601 timestamped rows to a TSV decision trail while sanitizing tabs, newlines, and spreadsheet-formula leading bytes (`=`, `+`, `-`, `@`).

## Complete dependency closure of pstack

### 1. Sibling plugin dependency: `cursor-team-kit` 1.2.0

`pstack/README.md` and `skills/poteto-mode/SKILL.md` depend on `cursor-team-kit` (`https://github.com/cursor/plugins/tree/main/cursor-team-kit`, version `1.2.0`, author Eric Zakariasson):

- **18 skills**: `check-compiler-errors`, `control-cli`, `control-ui`, `deslop`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, `loop-on-ci`, `make-pr-easy-to-review`, `new-branch-and-pr`, `pr-review-canvas`, `review-and-ship`, `run-smoke-tests`, `thermo-nuclear-code-quality-review`, `verify-this`, `weekly-review`, `what-did-i-get-done`, `workflow-from-chats`.
- **2 agents**: `agents/ci-watcher.md` and `agents/thermo-nuclear-code-quality-review.md`.
- **2 always-apply rules**: `rules/no-inline-imports.mdc` and `rules/typescript-exhaustive-switch.mdc`.
- **Executable JS asset (`skills/pr-review-canvas/`, `ev_2c98abedf7c1c05212d64174a87f0039f79218f72f4b0f1def35f6f3c2327ac9`)**: `renderer.js` (`ev_161a445223f452c7cc7f3104399476f625137fc93a3fc5fe4b9bd485742185c4`, 1,420 AST nodes, 3 boundary relations, 44 call-flow relations, 618 data-flow relations, 0 child-process relations), `template.html` (1 inline script at line 10 noted in REA limitations), and `styles.css`.

All 18 skills, 2 agents, 2 rules (vendored as skills plus always-applied system-prompt rules in `src/sections.ts`), and `pr-review-canvas` assets are vendored directly into `extensions/pi-pstack`.

### 2. Host built-in skill dependency: `create-skill`

`poteto-mode/SKILL.md`, `automate-me/SKILL.md`, and `playbooks/authoring-a-skill.md` invoke `create-skill`, which Cursor ships as a host built-in (`~/.cursor/skills-cursor/create-skill`). `extensions/pi-pstack/skills/create-skill/SKILL.md` vendors the full Pi-native equivalent (over 12 KiB, verified by `RES-001` and `check-parity-predicate.mjs`).

### 3. Npm package closure

| Package | Where declared | Role |
| --- | --- | --- |
| `commander@14.0.0` | `skills/poteto-mode/scripts/package.json` (`dependencies`) | CLI argument parsing in `watch-pr/cli.ts` |
| `bun-types@1.3.14`, `typescript@7.0.2` | `skills/poteto-mode/scripts/package.json` (`devDependencies`) | Typechecking for `watch-pr` |
| `fast-check@4.5.3` | `skills/statechart/scripts/package.json` (`devDependencies`) | Property-based tests in `statechart/scripts/test/` |
| `@anthropic-ai/sandbox-runtime@0.0.79` | `extensions/pi-pstack/package.json` (`dependencies`) | OS-level read-only shell sandboxing (`sandbox-exec` on macOS, `bwrap` + `socat` on Linux) for `readonly` subagents and `/plan` |
| `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`, `typebox` | `extensions/pi-pstack/package.json` (`peerDependencies: "*"`) | Host-supplied Pi runtime modules |

### 4. External CLI and runtime tool closure

- **Git (`git`)**: repository inspection, branch management, and isolated worker worktree creation (`git worktree add -b pstack/<agentId>` in `src/task/worktree.ts`).
- **GitHub CLI (`gh`) / Origin (`origin`)**: PR creation, review thread queries (`watch-pr/github.ts`), and PR polling (`src/subscriptions/github.ts`).
- **Bun (`bun`) and Node.js (`node >= 22.19.0`)**: script execution for `watch-pr`, `check-plan.mjs`, `statechart`, and `pstack-routines-supervisor`.
- **Search and JSON utilities (`rg`, `jq`)**: used by `worktree-audit.sh` and `make-bot-ui` credential wiring.
- **TLA+ toolchain (`mise`, `java@temurin-25`, `tla2tools.jar` / `tlc2.TLC`)**: used by `skills/statechart/scripts/run.ts`.
- **Media utilities (`ffmpeg`, `ffprobe`, `say` / `espeak-ng`, `open` / `xdg-open`)**: used by `skills/ketchup-video/SKILL.md`.

### 5. Host IDE mechanism contract (Cursor host vs Pi native mechanisms)

REA analysis of `extensions/pi-pstack/src` (`ev_6fe43d2bbfab36c6763a2d1e940ee728fdbbe2ad2abb9162f70c102ccab8860f`, outgoing trace `ev_22556088c77e2fa9073d079a7ed0796b2545e2f36a6223d130b2df64a8b04d12`) maps every host mechanism assumed by `pstack` to Pi 1.4.0 APIs:

| Upstream host mechanism | `pi-pstack` module | Pi 1.4.0 native mechanism used |
| --- | --- | --- |
| `/name` skill invocation & autocomplete | `src/aliases.ts`, `src/autocomplete.ts` | `pi.on('input')` transforming `/name` to `/skill:name`, `ctx.ui.addAutocompleteProvider`, `pi.getCommands()` |
| Custom Mode sticky skill (`poteto-mode`) | `src/mode.ts` | `pi.registerCommand('mode')`, `pi.appendEntry('pstack/mode')`, `ctx.sessionManager.getBranch()`, `stripFrontmatter`, `ctx.ui.setStatus`, `before_agent_start` `systemPromptOptions.sections.pstack_mode` |
| Plan Mode (read-only exploration) | `src/plan.ts`, `src/readonly-shell.ts` | `pi.registerCommand('plan')`, `pi.setActiveTools`, `pi.on('tool_call')` gate, `createBashTool` with `spawnHook` + `@anthropic-ai/sandbox-runtime` |
| Always-applied model rule (`pstack-models.mdc`) | `src/rule.ts`, `src/sections.ts` | `stripFrontmatter`, `before_agent_start` `systemPromptOptions.sections.pstack_models` and `pstack_host` |
| `Task` subagents (`fresh`, `resume`, `steer`, `fork`, `fork_turns`, `cloud` worktree, `readonly`, `file_attachments`) | `src/task/tool.ts`, `src/task/runner.ts`, `src/task/records.ts`, `src/task/registry.ts`, `src/task/worktree.ts` | `pi.registerTool`, `parseSessionEntries`, `SessionManager.open`, `SessionManager.forkFrom`, `detectSupportedImageMimeTypeFromFile`, `truncateHead`, `pi --mode rpc`, `pi.on('agent_before_settle')`, `pi.sendMessage` with `pi.registerMessageRenderer('pstack/task')` |
| `stop_agent` and `agent_status` | `src/task/stop.ts`, `src/task/status.ts` | `pi.registerTool` with MCP `annotations`, process-group signaling (`-pid`), run-lock inspection |
| `TodoWrite` checklist & widget | `src/todo.ts` | `pi.registerTool` (`executionMode: 'sequential'`), tool-result `details.todos` reconstructed from `ctx.sessionManager.getBranch()`, `ctx.ui.setWidget('pstack-todos')` |
| `AskQuestion` structured multiple-choice | `src/ask.ts` | `pi.registerTool` (`exposure: 'model-only'`, `executionMode: 'sequential'`), `ctx.ui.select`, `ctx.ui.input` |
| `/loop` and `Loop` tool | `src/loop.ts` | `pi.registerCommand('loop')`, `pi.registerTool`, `pi.on('agent_settled')`, `pi.sendUserMessage(..., { expandPromptTemplates: true })` |
| Subscriptions & webhook routines (`subscribe_github_pr`, `subscribe_timer`, `subscribe_webhook`, `list_subscriptions`, `unsubscribe`, `/routines`) | `src/subscriptions/*` | `pi.registerTool`, `pi.registerCommand('routines')`, `pi.appendEntry('pstack/subscriptions')`, `pi.sendMessage` with `pi.registerMessageRenderer('pstack/subscription')`, durable supervisor (`pstack-routines-supervisor`) with live-session wake delivery |
| `visualize` charts | `src/visualize.ts` | `pi.registerTool` rendering Unicode bar/line charts and writing standalone SVG files to the session artifacts directory |

## Residual unknowns and static analysis boundaries

1. **Static semantic graph bounds**: REA static analysis reports 3,303 semantic unknowns in `poteto-mode/scripts` (`ev_5cb366a2d252413ad6fc6350f1644aab7f751bfcfdd86e8af41a18851c99ac29`), 12,803 in `statechart/scripts` (`ev_ce9ee247f111b881d6c100242cfa0560623e65b11248377553e053fb8b6f62f3`), 356 in `pr-review-canvas` (`ev_d63a021f7e544b9403b2a48e25bebe7ad59220b82aa1378ffed159e559c2da19`), and 7,204 in `extensions/pi-pstack/src` (`ev_f5ea22bb2d470f8108ea52961fdbd0f8411142176ac7db78b0bdeca4c0f0e37e`). These represent dynamic property lookups and cross-function value flows that static AST analysis leaves unresolved; runtime behavior is verified instead by the 38 Vitest suites in `extensions/pi-pstack/test/`.
2. **Inline HTML script in `pr-review-canvas/template.html`**: REA notes 1 unanalyzed inline `<script>` starting at line 10 of `template.html` (`ev_d63a021f7e544b9403b2a48e25bebe7ad59220b82aa1378ffed159e559c2da19`). Direct source inspection shows it only boots `renderer.js` against `window.__PR_REVIEW_DATA__`.
