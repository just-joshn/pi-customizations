# Software architecture reconstruction: pstack 0.15.36 and dependencies

## Goal

Reconstruct the software architecture of `pstack` `0.15.36` and all of its dependencies with the REA MCP server, then map every upstream capability and dependency to Pi's native extension mechanisms in `pi-pstack` with zero dependencies on the upstream `pstack` plugin.

## Sources and REA evidence ledger

Every executable package in `pstack` `0.15.36`, its sibling `team-kit` `1.2.0` plugin, and `pi-pstack` `src/` was analyzed in this session with `rea-javascript-application` v1, `rea-analysis-view` v1, and `rea-javascript-application-workflows` v1.

| Target | Format | Root SHA-256 | Parent Evidence ID | Summary / View Evidence ID | Files / JS parsed |
| --- | --- | --- | --- | --- | --- |
| `pstack/skills/poteto-mode/scripts` (clean cache) | directory | `ab08fdd851002bfdd61fcc3c902bf0e6bb2bbd4b0229b5443e30626e3a788e07` | `ev_bf12ac9c3d463df579c1009ce80a874431c3cc14c168a783114077161d704139` | `ev_5cb366a2d252413ad6fc6350f1644aab7f751bfcfdd86e8af41a18851c99ac29`, `ev_f9e9795252c5470742dd90329b7bc1198882f4f5138e369cadb6a0397a0f5ee0`, `ev_5935daf21a6e6160681b399f1cc7482596cfedd3a7494c859a0e369fa6b0a946` | 15 relevant, 13 JS/TS parsed, 0 failures |
| `pstack/skills/poteto-mode/scripts` (with `node_modules`) | directory | `5b92deccc760dacf7f0f5278c2c4ecff34b98d87fc70f04fecc2210fcc52980c` | `ev_d6ff54533e36b7719f1b6e18031ee2521ff4368bdabe87f34372f46a1760c3e8` | retained in session bundle | Includes `commander@14.0.0` and `typescript@7.0.2` |
| `pstack/skills/statechart/scripts` | directory | `2193bf21071d9a8d176d142c5aa0d3257c98de4689e948e21b20957f83616e33` | `ev_5068b39b821b4f8848661475ed4d4e141343d183785cd0d1f48cc4c560700b24` | `ev_ce9ee247f111b881d6c100242cfa0560623e65b11248377553e053fb8b6f62f3`, `ev_bd7036ccd42e670602201871d0feba62dfffde58a1e942edcf879019555c25d2` | 50 relevant, 48 JS/TS parsed, 0 failures |
| `team-kit/skills/pr-review-canvas` | directory | `2666f69c5a27cb4256a403747f8606c55d68b7ab28556d7f0d3fe6fe359f9b3a` | `ev_2c98abedf7c1c05212d64174a87f0039f79218f72f4b0f1def35f6f3c2327ac9` | `ev_d63a021f7e544b9403b2a48e25bebe7ad59220b82aa1378ffed159e559c2da19`, `ev_2c3f2ede73725fa0fa715e3992b851b3e526d2df85d8e1ef1de50752d04bf93d` | 2 relevant, 1 JS parsed (`renderer.js`), 0 failures |
| `pi-pstack/src` | directory | `ebb60ef861603834b12d5f9a45f4108759d8c29d0605b38e07560456c0605ce8` | `ev_6fe43d2bbfab36c6763a2d1e940ee728fdbbe2ad2abb9162f70c102ccab8860f` | `ev_f5ea22bb2d470f8108ea52961fdbd0f8411142176ac7db78b0bdeca4c0f0e37e`, `ev_16b3d7080fa763f288e7e5a8291873a3bb1130fd1ad6be06070d51e7d753b71b` | 36 relevant, 36 TS parsed, 0 failures |
| `pi-pstack/skills/statechart/scripts` | directory | `9b47d92dbdc42204b53f020bdc7f802b6f5fff6220ecbe164dcf263906f2f914` | `ev_a8c8d7db63d2519d306e47d6d724a5119b28a1049a9eddbd73ea6f29dbc94caf` | `ev_1091007aca08202f865c78a8dd7452fa09d54fa0dcb807428f4d5c38732cb39f` | 50 relevant, 48 JS/TS parsed, 0 failures |
| `pi-pstack/skills/pr-review-canvas` | directory | `2666f69c5a27cb4256a403747f8606c55d68b7ab28556d7f0d3fe6fe359f9b3a` | `ev_e2dd5f48359956b83e32cdf0ac784c770cb97673cf712a4aaf490a27ecc1e8db` | `ev_12653e2b69c57038367443acf5635729793344211a0a13ef80a5c3dfdb1c376f` | 2 relevant, 1 JS parsed, 0 failures |

### Focused module item and trace Evidence IDs

- `bootstrap.ts` module item view: `ev_76dece32cf003cb0c2ba0994d5c886d5ff51b2c4dbeabc63e1b01fd5f4df0f42`
- `check-plan.mjs` module item view: `ev_d8b696f0eebbd0ee8619cb4a70bcfcec7d85d8f7c397a717799db1217e7ec99b`
- `statechart/scripts/run.ts` module item view: `ev_e43256ff8736be8e4ab9dc0a065c5acc134048f557bf3a9bd0b78ce537a1bc1b`
- `pr-review-canvas/renderer.js` module item view: `ev_161a445223f452c7cc7f3104399476f625137fc93a3fc5fe4b9bd485742185c4`
- Outgoing feature trace on `watch-pr/github.ts`: `ev_47b1b4f41568acc919b7b99f7b18014ab564745436bfc493d9bf88ad56f15f29` (18 matched seeds, 27 traced nodes, 28 traced edges)
- Outgoing feature trace on `statechart/scripts/run.ts`: `ev_b2c06c4cca93538bcb8b18f0570627f9149c127b69b3055b7a4d174dca19e6fd` (7 matched seeds, 115 traced nodes, 194 traced edges)
- Outgoing feature trace on `pi-pstack/src/index.ts`: `ev_22556088c77e2fa9073d079a7ed0796b2545e2f36a6223d130b2df64a8b04d12` (3 matched seeds, 372 traced nodes, 558 traced edges)
- Version comparison for `statechart/scripts`: `ev_a220a808b81c474aaaa62752f324f54976d47a43ccc4e7100da1cff2b4c470a4` (`changed: 1`, `added: 0`, `removed: 0`, only `package.json` package name differs)
- Version comparison for `pr-review-canvas`: `ev_1066025d4b0edd77d4d50a798a4cd11b3581a601509962224fa04546d55d549d` (`changed: 0`, `added: 0`, `removed: 0`, byte-identical SHA-256)

## Architecture of pstack 0.15.36 and its dependency graph

```
pstack 0.15.36
├── skills/ (58 workflow, principle, research, and verification skill directories)
├── agents/ (poteto-agent, comment-sicko)
├── automations/benny/ (setup-benny, triage-issue-reports, reproduce-and-fix-issues)
├── docs/guide/ (10 guide chapters + README)
└── soft dependencies (vendored into pi-pstack)
    ├── team-kit 1.2.0
    │   ├── skills/ (18 skills, including deslop, control-cli, control-ui, pr-review-canvas)
    │   ├── agents/ (ci-watcher, thermo-nuclear-code-quality-review)
    │   └── rules/ (no-inline-imports, typescript-exhaustive-switch)
    └── create-skill (host built-in skill for authoring and tuning SKILL.md files)
```

### Executable script packages inside the skill tree

1. **`skills/poteto-mode/scripts/` (`ev_bf12ac9c3d463df579c1009ce80a874431c3cc14c168a783114077161d704139`)**:
   - `bootstrap.ts` (`ev_76dece32cf003cb0c2ba0994d5c886d5ff51b2c4dbeabc63e1b01fd5f4df0f42`): verifies `node_modules/commander` and runs `bun install --frozen-lockfile` via `Bun.spawnSync` on first run before re-executing the target script.
   - `watch-pr/` (`cli.ts`, `github.ts`, `policy.ts`, `render.ts`, `types.ts`): CLI built on `commander@14.0.0` that polls GitHub PR status, review threads (`REVIEW_THREADS_QUERY`), check runs, and mergeability by spawning `gh` (`ev_47b1b4f41568acc919b7b99f7b18014ab564745436bfc493d9bf88ad56f15f29`).
   - `check-plan.mjs` (`ev_d8b696f0eebbd0ee8619cb4a70bcfcec7d85d8f7c397a717799db1217e7ec99b`): standalone Node script (`node:fs`, `node:process`) that validates multi-phase plan Markdown structure.
   - `worktree-audit.sh`: bash script using `git`, `rg`, `jq`, and BSD or GNU `stat` and `date` to classify git worktrees against Pi session and subagent transcript activity.
2. **`skills/statechart/scripts/` (`ev_5068b39b821b4f8848661475ed4d4e141343d183785cd0d1f48cc4c560700b24`)**:
   - `statechart` wrapper, `statechart.ts`, `worker.ts`, `pipeline.ts`, `ir.ts`, `run.ts` (`ev_e43256ff8736be8e4ab9dc0a065c5acc134048f557bf3a9bd0b78ce537a1bc1b`), `frontends/`, `passes/`, and `backends/`.
   - `run.ts` (`ev_b2c06c4cca93538bcb8b18f0570627f9149c127b69b3055b7a4d174dca19e6fd`) resolves Java (`java@temurin-25` through `mise` or `JAVA`) and `tla2tools.jar` (`TLA2TOOLS`), invokes `tlc2.TLC`, parses state graphs and counterexample traces into `ir.ts`, and renders terminal, SVG, and HTML statecharts.
3. **`skills/pr-review-canvas/` (`ev_2c98abedf7c1c05212d64174a87f0039f79218f72f4b0f1def35f6f3c2327ac9`)**:
   - `renderer.js` (`ev_161a445223f452c7cc7f3104399476f625137fc93a3fc5fe4b9bd485742185c4`), `template.html`, and `styles.css` render an interactive diff review canvas in the browser with zero npm dependencies.
4. **`skills/show-me-your-work/scripts/log.sh`**:
   - Appends ISO-8601 timestamped rows to a TSV decision trail while sanitizing tabs, newlines, and spreadsheet-formula prefix characters.

## Pi-native mechanism architecture in pi-pstack

REA analysis of `pi-pstack/src` (`ev_6fe43d2bbfab36c6763a2d1e940ee728fdbbe2ad2abb9162f70c102ccab8860f`, trace `ev_22556088c77e2fa9073d079a7ed0796b2545e2f36a6223d130b2df64a8b04d12`) maps each host feature to Pi 1.4.0 native extension mechanisms (`native-gaps.md` documents the remaining lower-level surfaces):

| Host capability | `pi-pstack` module | Pi 1.4.0 native mechanism |
| --- | --- | --- |
| `/name` skill aliases and completions | `src/aliases.ts`, `src/autocomplete.ts` | `pi.on('input')` rewriting `/name` to `/skill:name`, `ctx.ui.addAutocompleteProvider`, `pi.getCommands()` |
| Sticky mode (`/mode <skill>`) | `src/mode.ts` | `pi.registerCommand('mode')`, `pi.appendEntry('pstack/mode')`, `ctx.sessionManager.getBranch()`, `stripFrontmatter`, `ctx.ui.setStatus`, `before_agent_start` `systemPromptOptions.sections.pstack_mode` |
| Plan mode (`/plan`) | `src/plan.ts`, `src/readonly-shell.ts` | `pi.registerCommand('plan')`, `pi.setActiveTools`, `pi.on('tool_call')`, `createBashTool` with `spawnHook` and `@anthropic-ai/sandbox-runtime` |
| Model rule (`pstack-models.md`) | `src/rule.ts`, `src/sections.ts` | `stripFrontmatter`, `before_agent_start` `systemPromptOptions.sections.pstack_models` and `pstack_host` |
| `Task` subagents (`fresh`, `resume`, `steer`, `fork`, `fork_turns`, `cloud` worktree, `readonly`, `file_attachments`) | `src/task/tool.ts`, `src/task/runner.ts`, `src/task/records.ts`, `src/task/registry.ts`, `src/task/worktree.ts` | `pi.registerTool`, `parseSessionEntries`, `SessionManager.open`, `SessionManager.forkFrom`, `detectSupportedImageMimeTypeFromFile`, `truncateHead`, `pi --mode rpc`, `pi.on('agent_before_settle')`, `pi.sendMessage` with `pi.registerMessageRenderer('pstack/task')` |
| `stop_agent` and `agent_status` | `src/task/stop.ts`, `src/task/status.ts` | `pi.registerTool` with MCP `annotations`, process-group signaling (`-pid`), run-lock inspection |
| `TodoWrite` checklist and widget | `src/todo.ts` | `pi.registerTool` (`executionMode: 'sequential'`), tool-result `details.todos` reconstructed from `ctx.sessionManager.getBranch()`, `ctx.ui.setWidget('pstack-todos')` |
| `AskQuestion` structured questions | `src/ask.ts` | `pi.registerTool` (`exposure: 'model-only'`, `executionMode: 'sequential'`), `ctx.ui.select`, `ctx.ui.input` |
| `/loop` and `Loop` tool | `src/loop.ts` | `pi.registerCommand('loop')`, `pi.registerTool`, `pi.on('agent_settled')`, `pi.sendUserMessage(..., { expandPromptTemplates: true })` |
| Subscriptions and webhook routines (`subscribe_github_pr`, `subscribe_timer`, `subscribe_webhook`, `list_subscriptions`, `unsubscribe`, `/routines`) | `src/subscriptions/*` | `pi.registerTool`, `pi.registerCommand('routines')`, `pi.appendEntry('pstack/subscriptions')`, `pi.sendMessage` with `pi.registerMessageRenderer('pstack/subscription')`, durable supervisor (`pstack-routines-supervisor`) with live-session wake delivery |
| `visualize` charts | `src/visualize.ts` | `pi.registerTool` rendering Unicode bar and line charts and writing standalone SVG files to the session artifacts directory |

## Parity predicate

1. Every `pstack` `0.15.36` skill (58) and agent (2) exists under `pi-pstack`.
2. Every `team-kit` `1.2.0` skill (18), agent (2), and rule (2, as skills plus always-applied host prompt rules) plus `create-skill` (1) exists under `pi-pstack` (79 total skills, 4 agent files).
3. `pi-pstack` has zero runtime, manifest, script, or verification-gate dependencies on an upstream `pstack` plugin checkout or cache (`RES-011` in `test/resources.test.ts` and `zero-cursor-pstack-dependencies` in `parity/scripts/check-parity-predicate.mjs`).
4. Every host mechanism named in playbooks runs on Pi's native extension APIs (`ExtensionAPI`, `parseSessionEntries`, `SessionManager`, `stripFrontmatter`, `detectSupportedImageMimeTypeFromFile`, `truncateHead`, `createBashTool`, `registerMessageRenderer`, `registerTool`, `registerCommand`).
5. `bun run typecheck`, `bun run test`, `node parity/scripts/check-parity-predicate.mjs`, and `node scripts/check-pi-mechanisms.mjs` pass.

## REA coverage notes

Static JavaScript and TypeScript semantic graphs report bounded unknowns for dynamic property lookups and cross-function value flows (3,303 in `poteto-mode/scripts`, 12,803 in `statechart/scripts`, 356 in `pr-review-canvas`, and 7,204 in `pi-pstack/src`), and 1 unanalyzed inline script in `pr-review-canvas/template.html`. Runtime behavior is verified by the 38 Vitest test files in `test/`. See [`native-gaps.md`](native-gaps.md) for the remaining lower-level Pi 1.4.0 surfaces.
