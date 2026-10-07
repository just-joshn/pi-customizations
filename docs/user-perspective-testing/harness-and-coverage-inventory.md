# Harness and coverage inventory

Reconnaissance for the user-perspective verification program.

- Repo: `/Users/josh-desktop/src/personal/user-perspective-testing-extensions`
- Date: 2026-10-07
- Method: read every file named in the task; counts from `grep -E '\b(it|test)\('` over `*.test.ts` (excluding `node_modules` and every directory named `upstream`) and `def test_` for Python, as the task prescribed. That pattern does not match `test.each(`, `test.skipIf(...)(...)`, or `test.runIf(...)(...)`, so those call sites are undercounted; counts that include those forms as well are shown beside the strict counts. `describe` blocks are not counted. No repository source file was modified.
- Every claim cites `file:line`. Where a conclusion is inferred rather than read directly, it is marked as an inference.

## control-pi capability

`control-pi` is one 393-line Node ESM executable at `.pi/skills/verify-pi-customizations/bin/control-pi`. Verbs:

- `control-pi doctor` (dispatch `.pi/skills/verify-pi-customizations/bin/control-pi:370`).
- `control-pi drive <pstack-status|poteto-mode|standalone-skills|oauth-providers> [--out <dir>]` (dispatch `.../bin/control-pi:372-385`). `--artifact-dir` is accepted as an alias for `--out` (`.../bin/control-pi:374`). Unknown feature names throw with the expected list (`.../bin/control-pi:384`).
- No verb or unknown verb: prints usage and exits 1 (`.../bin/control-pi:387-392`).

How it starts Pi. `createRpcSession(packagePath, cwd)` spawns:

```
.../bin/control-pi:38  const child = spawn('pi', ['--mode', 'rpc', '--no-session', '--no-extensions', '-e', packagePath], {
.../bin/control-pi:39    cwd,
.../bin/control-pi:40    env: { ...process.env, PI_CODING_AGENT_DIR: cwd },
.../bin/control-pi:41    stdio: ['pipe', 'pipe', 'pipe'],
```

`cwd` is always a fresh `mkdtemp('/tmp/control-pi-…')` scratch directory (`.../bin/control-pi:211`, `:253`, `:287`, `:323`), removed in `finally`; artifacts survive. Requests time out after 15s (`.../bin/control-pi:15`, `:120`). Close ends stdin, waits `SHUTDOWN_TIMEOUT_MS` 5s, then SIGKILLs only its own child (`.../bin/control-pi:148-160`); there is no `pkill` (`SKILL.md:88-92`).

How it asserts. JSON lines on stdout are parsed (`.../bin/control-pi:61-92`). `response` records resolve by id; `extension_ui_request` records are captured only when `method === 'notify'` (`.../bin/control-pi:81-82`); every `entry_appended` record is captured (`.../bin/control-pi:83-84`). Getters `notifications` (`:138`), `entries` (`:141`), `stderr`. Each drive uses Node `assert` predicates (exact match/regex) and throws on failure; the top-level catch prints `[control-pi error]` and exits 1 (`:394-397`).

Per verb/function:

- `parseArgs` (`:18-33`): `command`, positional target, `--key value` or boolean `--key`.
- `runDoctor` (`:163-204`): Node >= 22.19.0; `pi --version` on PATH; repo-root `package.json` exists; real RPC boot of the repo root returns `get_commands` as an array.
- `drivePstackStatus` (`:206-246`): loads `extensions/pi-pstack` (`:212`); prompts `/pstack status`; filters `get_messages` for `role === 'custom' && customType === 'pstack-status'` (`:220`); asserts pstack version, `team-kit`, and `N skills, N prompt templates` (`:223-225`); prompts `/pstack todos`; asserts `Todos: none.` (`:236`). Writes `status.txt`, `status.json`, `todos.txt` (`:227-228`, `:238`).
- `drivePotetoMode` (`:248-280`): loads `extensions/pi-pstack`; prompts `/poteto-mode off`; asserts exact notification `Poteto mode is off.` (`:260-264`); asserts an appended entry with `customType === 'pstack-state'` and `data.enabled === false` (`:266-269`). Writes `off.txt`, `off.json` (`:271-272`).
- `driveStandaloneSkills` (`:282-316`): loads the repo root (`:290`); `get_commands`; filters `source === 'skill' && name.startsWith('skill:')` (`:293`); asserts exactly `skill:doctor`, `skill:implement-cli-from-contract`, `skill:reverse-engineer-cli`, `skill:run`, `skill:simplify` (`:295-305`). Writes `skills.txt`, `skills.json` (`:307-308`).
- `driveOauthProviders` (`:318-364`): writes a synthetic `auth.json` with mode 0600 containing fixture OAuth records for `claude-subscription`, `google-antigravity` (with `projectId` and `email`), and `grok-build` (`:325-331`); runs `pi --no-extensions -e extensions/<pkg> --list-models <provider>` with `execFileSync` for `pi-anthropic-oauth` (`:334-338`), `pi-antigravity-oauth` (`:342-346`), and `pi-xai-oauth` (`:350-354`); asserts one model regex per provider (`:339`, `:347`, `:355`). Writes `claude-models.txt`, `antigravity-models.txt`, `grok-build-models.txt` (`:357-359`).

Evidence destinations default to `artifacts/verify-pi-customizations/<feature>/` (`SKILL.md:68-83`). The skill contract that maps user actions to drives lives in `features/README.md:27-33` (four-H2 entry contract) and `features/README.md:36-44` (proof and skip-reporting rules).

## control-pi extension points

`control-pi` is not generic. It is a hard-coded `if/else` over four feature identifiers, each with its own drive function and hard-coded package path. The dispatch is:

```
374:      const artifactDir = flags['artifact-dir'] || flags.out;
375:      if (feature === 'pstack-status') {
376:        await drivePstackStatus(artifactDir);
377:      } else if (feature === 'poteto-mode') {
378:        await drivePotetoMode(artifactDir);
379:      } else if (feature === 'standalone-skills') {
380:        await driveStandaloneSkills(artifactDir);
381:      } else if (feature === 'oauth-providers') {
382:        await driveOauthProviders(artifactDir);
383:      } else {
384:        throw new Error(`Unknown feature to drive: '${feature}'. Expected: pstack-status, poteto-mode, standalone-skills, oauth-providers`);
```

Adding a new feature drive requires editing `bin/control-pi` in three places plus docs:

1. A new `driveX(artifactDir)` function following the shape at `.../bin/control-pi:206-246`: `mkdir(outDir)`, `mkdtemp` scratch, `createRpcSession(packagePath, scratch)`, send prompts, assert captured records, write artifacts, `finally` close + scratch removal.
2. An `else if (feature === '<name>')` branch at `.../bin/control-pi:375-384`. The loaded package is hard-coded per branch: `extensions/pi-pstack` at `:212` and `:254`, the repo root at `:290`, three OAuth package dirs at `:333-359`. The OAuth drive additionally uses `execFileSync` rather than an RPC session (`:334-354`).
3. Update the error string at `.../bin/control-pi:384` and add a feature doc satisfying `features/README.md:27-33` (H1, one paragraph, exactly four H2 sections in order) with skip reporting per `features/README.md:38-44`.

The RPC client itself is generic: `send(payload)` writes `{id, ...payload}` (`.../bin/control-pi:106-127`), so arbitrary prompts (`{type:'prompt', message:'/anything'}`) are one function call away; only the CLI surface is fixed. Tests inside the repo already demonstrate the missing dialog bridge: `extensions/pi-pstack/scripts/journey-client.mjs:12-44` responds to `extension_ui_request` (select/confirm/input) with `extension_ui_response` and a dialog budget. `control-pi` has no equivalent.

## control-pi limits

- TUI: cannot drive it. Every session is `--mode rpc` over piped stdio (`.../bin/control-pi:38`). There is no tmux, PTY, or terminal emulation in the script. TUI-only behavior (todo widget, status line, task panel, themes) is unobservable. `features/pstack-status.md:40` states the recipe "does not test the TUI window or multiline rendering."
- Interactive prompts and dialogs: cannot answer them. Only `extension_ui_request` records with `method === 'notify'` are captured (`.../bin/control-pi:81`); `select`, `confirm`, `input`, and permission requests are dropped, and no `extension_ui_response` is ever written. A drive that triggers a dialog stalls until the 15s request timeout (`.../bin/control-pi:15`). (The separate journey helper does bridge dialogs, but `control-pi` does not.)
- Arbitrary slash commands: the protocol allows them through `send({type:'prompt'})`, and `drivePstackStatus`/`drivePotetoMode` use exactly that (`.../bin/control-pi:218`, `:259`), but there is no generic prompt verb in the CLI. Testing a new command means writing code (see extension points).
- Restart and persistence: cannot test. Every session is `--no-session` (`.../bin/control-pi:38`), each drive creates a new scratch agent dir and deletes it, and no drive reopens a session or switches branches. `features/poteto-mode.md:33` admits: "does not verify ... restoration after restart or branch navigation."
- OAuth login flows: cannot test. The OAuth drive fabricates `auth.json` and runs `--list-models` only (`.../bin/control-pi:325-357`). `features/oauth-providers.md:27` says the drive "does not prove login, token validity, token refresh, or a successful model response."
- Failed/timed-out provider requests: cannot test. No request is sent to any provider; there is no network failure, retry, rate-limit, or cancellation drive. `features/oauth-providers.md:27,37`.
- Themes: cannot test. `control-pi` never references `pi-tui-skin`, `pi-one-dark-pro-theme`, or `/theme`; there is no theme drive, and terminal rendering cannot be observed over RPC pipes.
- Other unexercised paths in the shipped drives: non-empty todo list and the todo summary count (`features/pstack-status.md:33`), `/poteto-mode` activation, `/skill:poteto-mode off`, direct `pstack_mode` calls (`features/poteto-mode.md:33`), and any workflow execution or model call (`SKILL.md:84`).

## Per-package automated coverage

Legend for the per-file tags:

- `unit` — imports package source directly; no subprocess.
- `mocked-unit` — unit plus `vi.mock`.
- `sdk-scripted` — drives the Pi SDK (`createAgentSession`, `DefaultResourceLoader`, `test/session-fixture.ts`) with an in-process scripted provider; no Pi binary and no network.
- `real-pi` — spawns Pi itself (`@earendil-works/pi-coding-agent` `bundle/cli.js` or `dist/cli.js`), directly or through a harness.
- `child` — spawns another child process (project CLI, node script, or stubs).
- `local-http` — starts a loopback HTTP server.
- `cond` — has `skipIf`/`runIf` gating.
- `external` — requires something outside the repo (external checkout, network, real binary).

Summary counts (call-site method above):

| Package | Test files | Strict call sites | Also counting `.each`/`.skipIf`/`.runIf` | Runner |
| --- | --- | --- | --- | --- |
| pi-pstack | 215 | 1473 | 1610 | vitest, minus `skills/**` (see below) |
| pi-anthropic-oauth | 19 | 138 | 153 | vitest |
| pi-antigravity-oauth | 11 | 145 | 175 | vitest |
| pi-xai-oauth | 7 | 71 | 73 | vitest |
| pi-caveman | 22 | 280 | 313 | vitest (no Makefile target) |
| pi-s50 | 20 | 216 | 252 | vitest |
| pi-tui-skin | 13 | 157 | 168 | vitest |
| pi-one-dark-pro-theme | 5 | 82 | 84 | vitest |
| repo root (Python) | 11 | 134 | 134 | `uv run ... unittest` in `verify-python` |

No test file in any package contains `.skip(`, `.todo(`, or `.only(`. All conditional cases use `skipIf`/`runIf` or a local `available` predicate. No package test reaches a live third-party service except the single `S50_LIVE=1` case noted below and `pi-caveman`'s unwired e2e scripts.

### pi-pstack

215 test files, 1473 call sites. Breakdown:

- 194 files under `extensions/pi-pstack/test/` (excluding `test/helpers/`), 17 under `extensions/pi-pstack/test/helpers/` (188 call sites), 4 under `extensions/pi-pstack/skills/` (52 call sites).
- `extensions/pi-pstack/vitest.config.ts:12` excludes `dist/**`, `upstream/**`, `upstream-team-kit/**`, and `skills/**`. The 4 skill-level files (`skills/poteto-mode/scripts/orch/orch.test.ts`, `skills/poteto-mode/scripts/watch-pr/{cli,github,policy}.test.ts`) are therefore never run by `test`, `test:coverage`, or `test:helpers`; no other gate references them.
- `test/helpers/` runs twice: once in the default `vitest run` and again via `test:helpers` (`extensions/pi-pstack/package.json:63`).
- The vendored `upstream/` copies are excluded from vitest. `test/upstream/render.test.mjs` (6 bun-test cases) runs only inside `check:upstream` (`extensions/pi-pstack/scripts/verify-upstream.mjs`), which `make verify` does not invoke.
- 31 files use the SDK session fixture (`test/session-fixture.ts`), 15 files spawn a real Pi bundle (`test/user-perspective.test.ts:289-296`, `test/rpc-dialogs.test.ts:95-122`, and the 13 files using `startDetachedRpc` from `scripts/detached-rpc-client.mjs:79-90`, which resolves `bundle/cli.js` at `:82-84`). 34 files spawn some child process. 10 files use `vi.mock`.
- Transitive real-Pi coverage: `test/timer-service.test.ts`, `test/timer-tool-journey.test.ts`, `test/timer-recovery.test.ts`, and `test/workers.test.ts` spawn initiator scripts (`test/timer-initiator.mjs`, `test/timer-tool-initiator.mjs`) that start detached Pi roots; they are tagged `child` below but exercise a real Pi process.
- Conditional cases: `test/canvas-browser-evidence.test.ts:9-15` and `test/canvas-browser-signal.test.ts` require macOS plus Google Chrome at a hard-coded path; `test/routine-isolation.test.ts:12`, `test/cloud-filesystem.test.ts:31`, and `test/detached-isolation.test.ts:13-30` are gated on `process.platform`.
- Strict counts below read 0 for 40 files whose only cases are written as `test.each(...)(...)` or `test.skipIf(...)(...)`; those forms do not match the prescribed `test(` pattern. The expanded-case totals in the table above include them. Examples: `test/canvas-browser-evidence.test.ts` (1 case), `test/canvas-browser-signal.test.ts` (1 `each` call expanding to 2 cases), `test/how-command-rpc.test.ts`, `test/rpc-dialogs.test.ts`.

All 215 files, one line each. `real-pi` marks files that spawn the vendored Pi bundle, directly or through the detached-RPC helper; `sdk-scripted` marks files using `test/session-fixture.ts` with an in-process scripted provider.

#### Core `test/` (194 files)
- `test/agent-sources.test.ts` [unit] (4 call sites) — markdownAgentFiles tells a populated directory from a missing one.
- `test/alias-resources.test.ts` [sdk-scripted] (6 call sites) — a real user template wins a package alias collision and keeps native argument grouping.
- `test/benny-parity.test.ts` [child] (10 call sites) — setup names exactly thirteen numbered choices.
- `test/benny.test.ts` [child] (16 call sites) — the dormant native pack preserves source algorithms and replaces host setup mechanics.
- `test/canvas-browser-evidence.test.ts` [sdk-scripted, child, cond] (0 call sites) — real canvas browser saves accessibility and profiling evidence.
- `test/canvas-browser-signal.test.ts` [sdk-scripted, child, cond] (0 call sites) — real Chrome canvas browser signal handling (SIGINT/SIGTERM) through the vendored probe script.
- `test/catalog.test.ts` [unit] (2 call sites) — catalog maps skill, host skill, and playbook names to their files.
- `test/child-rpc.test.ts` [unit] (10 call sites) — concurrent commands each resolve with their own response data.
- `test/child-task-control.test.ts` [unit] (7 call sites) — a permission ask the parent $name reaches the child as $answer.
- `test/child-task-lifecycle.test.ts` [unit] (14 call sites) — a fresh task has its identity but no process.
- `test/child-turn.test.ts` [unit] (7 call sites) — each finished tool execution adds one tool use.
- `test/cleanup.test.ts` [unit] (1 call site) — fixture cleanup restores environment and removes files even when abort rejects.
- `test/cli.test.ts` [child] (6 call sites) — journey verifier selector rejection; spawns project verification scripts.
- `test/cloud-directory.test.ts` [sdk-scripted] (4 call sites) — detached preparations use task-owned directories without launching sessions.
- `test/cloud-filesystem.test.ts` [real-pi, cond] (1 call site) — cloud visibility includes global, custom and orchestration stores but allows only owned paths.
- `test/cloud-record-control.test.ts` [real-pi, sdk-scripted, child] (5 call sites) — cloud record control reads a finished main-session snapshot without launching Task.
- `test/cloud-runtime-control.test.ts` [real-pi, sdk-scripted] (5 call sites) — TaskMessage queues steering on a restored cloud task through its detached root.
- `test/cloud-startup.test.ts` [real-pi, sdk-scripted, mocked-unit] (1 call site) — a rejected first cloud prompt closes its mocked allocation and records failure.
- `test/cloud-tasks.test.ts` [real-pi] (6 call sites) — a background cloud task that exited without a snapshot settles as interrupted, is saved, and wakes the parent.
- `test/commands.test.ts` [unit] (12 call sites) — /poteto-mode off and /skill:poteto-mode off give the same confirmation.
- `test/context-review.test.ts` [unit] (7 call sites) — context counts separators at the exact multibyte list boundary.
- `test/context-rpc.test.ts` [real-pi, sdk-scripted] (1 call site) — real RPC context discovers the configured session directory and returns only its workspace.
- `test/decision-audit.test.ts` [sdk-scripted, child] (1 call site) — trail audit distinguishes resolving pointers from unmatched evidence.
- `test/decision-log.test.ts` [sdk-scripted, child] (1 call site) — decision log sanitizes cells and appends without rewriting history.
- `test/deferred-wakes.test.ts` [sdk-scripted] (6 call sites) — an idle parent receives a wake immediately without holding it for a boundary.
- `test/deliver.test.ts` [unit] (3 call sites) — interactive delivery queues the message and returns at once.
- `test/dependency-mappings.test.ts` [child] (4 call sites) — documented host dependency mappings across Pi, skills, and agent docs.
- `test/detached-activity.test.ts` [unit] (3 call sites) — only final settlement completes a running invocation.
- `test/detached-isolation.test.ts` [real-pi, cond] (1 call site) — unrestricted transport launch remains unchanged.
- `test/detached-records.test.ts` [unit] (2 call sites) — restoration preserves a detached invocation for reconnection.
- `test/detached-rpc.test.ts` [real-pi, sdk-scripted, child] (7 call sites) — a detached Pi RPC process accepts control from a reopened handle without model calls.
- `test/durable-client-cancellation.test.ts` [unit] (10 call sites) — pre-aborted clients write no drafts, launch records, or commands.
- `test/ephemeral-dirs.test.ts` [sdk-scripted] (3 call sites) — removeAll deletes only the directories created for that owner.
- `test/expect-defined.test.ts` [unit] (1 call site) — defined test values preserve $0.
- `test/first-action-rule.test.ts` [sdk-scripted] (5 call sites) — an Anthropic model in poteto mode is told to read the playbook and open a todolist first.
- `test/goal-behavior.test.ts` [unit] (11 call sites) — goal arguments parse time limits and leave other numbers in place.
- `test/goal-usage-rpc.test.ts` [real-pi, sdk-scripted] (1 call site) — installed RPC preserves synthetic nonzero usage after goal completion and reopening.
- `test/goal.test.ts` [sdk-scripted] (5 call sites) — goal completion and session reopening preserve nonzero session usage.
- `test/history-boundary.test.ts` [unit] (2 call sites) — handles UTF-8, blank prefixes, EOF headers, malformed records and symlink ownership.
- `test/history-paths.test.ts` [unit] (2 call sites) — workspace file URLs retain SDK discovery without admitting foreign ownership.
- `test/history-profile-signal.test.ts` [sdk-scripted, child] (0 call sites) — interrupting the owned history profiler with %s removes its corpus.
- `test/history-profile.test.ts` [sdk-scripted, child] (1 call site) — history profiler records both readers and refuses reused evidence.
- `test/history.test.ts` [mocked-unit] (3 call sites) — authorizes ownership before body reads and preserves names and activity ordering.
- `test/host-environment.test.ts` [real-pi, sdk-scripted] (1 call site) — host catalog respects detached owner marker $owner.
- `test/how-command-rpc.test.ts` [real-pi, sdk-scripted] (0 call sites) — real RPC $resource delivers How without executing agents.
- `test/integration.test.ts` [sdk-scripted] (30 call sites) — integration fixture setup failure removes its directory.
- `test/latest-content-parity.test.ts` [unit] (7 call sites) — perf issue delivers the seven performance mantras in order.
- `test/latest-source.test.ts` [child] (0 call sites) — source checker fixture: normalized text, binary bytes, external cursor authors, pagination.
- `test/latest-workflows.test.ts` [sdk-scripted] (3 call sites) — latest workflow %s has a native skill and prompt alias.
- `test/leaks.test.ts` [unit] (7 call sites) — leakPrefix strips the mkdtemp suffix from $name.
- `test/model-errors.test.ts` [unit] (3 call sites) — model rule reads propagate non-ENOENT errors.
- `test/models.test.ts` [unit] (18 call sites) — setup offers the four documented reasoning budgets.
- `test/native-parity-gate.test.ts` [child] (13 call sites) — a fully covered clause whose quote exists in a native file passes.
- `test/native-tool-metadata.test.ts` [unit] (0 call sites) — $namespace publishes native group guidance.
- `test/native-typescript-source.test.ts` [unit] (2 call sites) — native parsing preserves source text and syntax for %s.
- `test/parity-ci-cloud-root.test.ts` [real-pi] (1 call site) — timer and CI subscription armed from a cloud Task root run on the guest and outlive that root.
- `test/parity-ci-subscription.test.ts` [unit] (9 call sites) — a GitHub CI subscription wakes the owning root once per terminal state through pending, success and failure.
- `test/parity-contracts.test.ts` [unit] (6 call sites) — content lines skip blanks, headings, table rules, and fence markers but keep fenced text.
- `test/parity-generator-flags.test.ts` [unit] (5 call sites) — every generated skill keeps its upstream model-invocation flag.
- `test/parity-generator-forge.test.ts` [unit] (9 call sites) — every forge-resolving playbook detects the origin CLI at its installed path and repairs it before any gh fallback.
- `test/parity-generator-paths.test.ts` [child] (10 call sites) — no generated skill or prompt names a repository-root pstack path.
- `test/parity-generator-placement.test.ts` [unit] (9 call sites) — swarm fans out all workers in one message with the upstream subagent type, background flag, and cloud default.
- `test/parity-generator-playbooks.test.ts` [unit] (10 call sites) — generated resources do not retain Reference-only nouns and paths.
- `test/parity-generator-skills.test.ts` [unit] (11 call sites) — generated skill prose has no long dash outside the setup-pstack labels.
- `test/parity-package-docs.test.ts` [unit] (15 call sites) — README lists every playbook in the playbooks directory.
- `test/parity-package-host-skills.test.ts` [unit] (16 call sites) — the origin skill installs from the official HTTPS URL.
- `test/parity-package-manifest.test.ts` [child] (6 call sites) — the manifest declares a homepage and repository for the package directory.
- `test/parity-runtime-agents.test.ts` [sdk-scripted] (2 call sites) — the poteto-agent persona defaults to fresh workers and permits reuse only for costly state.
- `test/parity-runtime-host-version.test.ts` [unit] (1 call site) — Pi $installed against tested $tested gives $notice.
- `test/parity-runtime-host.test.ts` [sdk-scripted] (11 call sites) — host contract names the agent store, its orchestrate and docs directories, and the ORCH_STORE export.
- `test/parity-runtime-mode.test.ts` [sdk-scripted] (3 call sites) — the injected mode section begins with the upstream reminder and the reminder is gone after off.
- `test/parity-runtime-models.test.ts` [unit] (3 call sites) — setup warns when a panel role has fewer than two model families and still writes the rule.
- `test/parity-runtime-nesting.test.ts` [unit] (2 call sites) — a Task child can start grandchildren to depth 3 and every level settles.
- `test/parity-runtime-readonly.test.ts` [unit] (4 call sites) — the SDK tool annotations that could classify extension tools are unverified author hints.
- `test/permission-relay.test.ts` [unit] (5 call sites) — tool policy in $mode mode.
- `test/personas.test.ts` [unit] (7 call sites) — general purpose has no extra instructions or default model.
- `test/pi-command.test.ts` [unit] (4 call sites) — PSTACK_PI_COMMAND "$configured" wins over everything else.
- `test/pi-version.test.ts` [unit] (0 call sites) — %s develops against Pi 1.0.2 without bundling host packages.
- `test/process-signal.test.ts` [child] (8 call sites) — signalProcess treats %s as a process that is already gone.
- `test/remote-cloud-routing.test.ts` [mocked-unit] (1 call site) — cloud Tasks reject missing VM placement before creating any local worktree.
- `test/remote-executors.test.ts` [unit] (5 call sites) — remote commands target an explicit machine without a shell or host environment.
- `test/remote-lease.test.ts` [child] (1 call site) — an independent machine admits one task owner until explicit release.
- `test/remote-tasks-roster.test.ts` [unit] (11 call sites) — a session url names this host plus the session.
- `test/remote-worker-transport.test.ts` [unit] (4 call sites) — remote requests travel over stdin without forwarding model credentials.
- `test/remote-worker.test.ts` [child] (7 call sites) — init.
- `test/research-parity.test.ts` [child] (9 call sites) — poteto-mode routes all 23 documented playbooks and 24 principles.
- `test/resource-environment.test.ts` [real-pi, sdk-scripted] (5 call sites) — Origin retains its source cloud exclusion while remaining available locally.
- `test/resources.test.ts` [child] (10 call sites) — resource generation reproducibility and source-bundle fixtures through `scripts/resources.mjs`.
- `test/restored-context.test.ts` [unit] (3 call sites) — an empty branch restores no identity and depth zero.
- `test/routine-field-names.test.ts` [unit] (3 call sites) — preserves the declared JSON member name $field.
- `test/routine-isolation.test.ts` [child, cond] (0 call sites) — the real routine subprocess cannot read its key or change coordinator state but can write its session.
- `test/routine-relay.test.ts` [local-http] (4 call sites) — the server relay sends both auth headers once and exposes only the acceptance receipt.
- `test/routine-secret.test.ts` [child] (0 call sites) — hidden terminal initializer restores echo after %s.
- `test/routine-service.test.ts` [child] (8 call sites) — preparing a routine creates a private immutable disabled draft.
- `test/routines.test.ts` [sdk-scripted, mocked-unit] (9 call sites) — the activation dialog binds the exact revision and cancellation keeps it disabled.
- `test/rpc-dialogs.test.ts` [real-pi, child] (0 call sites) — installed Pi RPC delivers $scenario to AskQuestion.
- `test/rpc-process.test.ts` [child] (5 call sites) — RPC extension errors reject pending requests even when the command succeeds.
- `test/rpc-turn.test.ts` [child] (3 call sites) — RPC acknowledgement is not settlement.
- `test/setup-tool-behavior.test.ts` [mocked-unit] (2 call sites) — a confirmed setup reports the written configuration and offers verification.
- `test/setup-tool.test.ts` [unit] (1 call site) — natural language setup uses the same interactive gate and rejects unattended writes.
- `test/shell-descendants.test.ts` [child, mocked-unit] (3 call sites) — descendants walks the ps table breadth-first from the given root.
- `test/shell-ownership.test.ts` [unit] (5 call sites) — shell role for $role.
- `test/shell-termination.test.ts` [child] (2 call sites) — SIGTERM-ignoring shells are SIGKILLed after the 1.5s grace; descendant backstop.
- `test/shells.test.ts` [sdk-scripted, child] (6 call sites) — a quiet exit during a held parent turn produces only the match request.
- `test/skill-layering.test.ts` [unit] (1 call site) — every upward or cyclic skill reference is one the reference document documents.
- `test/skills-parity.test.ts` [sdk-scripted, child] (11 call sites) — skills inventory: all pstack, team-kit, and loop skills are accounted for.
- `test/source-census.test.ts` [child] (2 call sites) — source census retains every nonblank Markdown line as unreviewed evidence, not verification.
- `test/source-policy-contract.test.ts` [unit] (5 call sites) — ${path} preserves its source policy contract.
- `test/state-snapshots.test.ts` [unit] (19 call sites) — TodoWrite publishes independent todos rather than caller-owned records.
- `test/structure.test.ts` [unit] (5 call sites) — maintained extension code and tests meet the repository size and logging limits.
- `test/subagents-abort-reasons.test.ts` [unit] (4 call sites) — a foreground permission stop becomes sync permission telemetry with a cutoff note.
- `test/subagents-agent-locations.test.ts` [unit] (5 call sites) — user directories are the Reference Assistant one then the pi agent directory.
- `test/subagents-agent-records.test.ts` [unit] (7 call sites) — a failed node reports its error and falls back when none was recorded.
- `test/subagents-agent-registry.test.ts` [unit] (11 call sites) — the offered built-ins hide gated agents until their gate opens.
- `test/subagents-agent-storage.test.ts` [unit] (6 call sites) — child storage paths are namespaced under the validated parent session.
- `test/subagents-builtin-agents.test.ts` [unit] (8 call sites) — explore declares two candidate models, low effort and a read-only tool list.
- `test/subagents-child-mcp.test.ts` [unit] (1 call site) — a child honors the native project enabled override %s for a user MCP server.
- `test/subagents-child-task.test.ts` [unit] (1 call site) — opening a child fails instead of falling back when its recorded cwd is missing.
- `test/subagents-child-trust.test.ts` [unit] (0 call sites) — a child loads the project extension: $loaded when the parent trusts the project: $trusted.
- `test/subagents-commands.test.ts` [unit] (19 call sites) — /tasks lists active agents, hides idle ones and lists them with all.
- `test/subagents-completion-notice.test.ts` [unit] (8 call sites) — the last assistant message with usage determines the metered token total.
- `test/subagents-context-board.test.ts` [unit] (5 call sites) — the board path is stable per working directory and distinct across directories.
- `test/subagents-context-builder.test.ts` [unit] (5 call sites) — a plan carries the user message with the datetime tag and the identity headers.
- `test/subagents-custom-agents.test.ts` [unit] (10 call sites) — a minimal agent takes its name from the file and defaults the optional fields.
- `test/subagents-delegation-guidance.test.ts` [unit] (7 call sites) — the tool description opens with the header and lists built-in then custom agents.
- `test/subagents-depth-tree.test.ts` [unit] (1 call site) — [G1-13] real SDK tree navigation resets absent depth to main zero.
- `test/subagents-direct-helpers.test.ts` [unit] (11 call sites) — sameModel compares normalized ids and accepts a provider-qualified reference.
- `test/subagents-environment-facts.test.ts` [unit] (5 call sites) — facts combine the repository root, os name, snapshot and the tools found on the path.
- `test/subagents-events.test.ts` [unit] (12 call sites) — a durable event is emitted and persisted with an iso timestamp and a null parent.
- `test/subagents-finalize.test.ts` [unit] (12 call sites) — a plain report passes through with no harness notes and a fingerprint.
- `test/subagents-hooks.test.ts` [unit] (6 call sites) — hooks are read from the settings hooks section as strings or objects with a timeout.
- `test/subagents-host-effects.test.ts` [unit] (7 call sites) — start_subagent $action answers from the host state.
- `test/subagents-identifiers.test.ts` [unit] (3 call sites) — [G2-34] persisted parent scope ID is validated before worker directory creation.
- `test/subagents-identity.test.ts` [unit] (2 call sites) — every child model request carries the identity headers.
- `test/subagents-limiter.test.ts` [unit] (9 call sites) — a spawn at the concurrent limit is rejected with the model-visible text.
- `test/subagents-limits.test.ts` [unit] (2 call sites) — the result text limit stays the documented 100000 characters.
- `test/subagents-mcp-specs.test.ts` [unit] (9 call sites) — undefined means the agent declared no MCP servers.
- `test/subagents-model-history.test.ts` [unit] (2 call sites) — model history preserves model transitions while collapsing adjacent repeats.
- `test/subagents-model-walk.test.ts` [unit] (31 call sites) — a required setting beats the definition models and effort.
- `test/subagents-native-first.test.ts` [child] (2 call sites) — the pi-subagents source is clean while the same gate catches a planted stand-in.
- `test/subagents-notification.test.ts` [unit] (3 call sites) — [B65][B67][B106] a completed agent renders the task-notification markup with summary, note, result and usage.
- `test/subagents-orphan-notices.test.ts` [unit] (10 call sites) — singleNote redispatched=$redispatched saved=$transcriptSaved canRead=$canRead.
- `test/subagents-orphan-plan.test.ts` [unit] (7 call sites) — [C110] only background tasks whose latest record is running are orphans, and repeat launches mark a redispatch.
- `test/subagents-orphan-recovery.test.ts` [unit] (8 call sites) — with no orphans nothing is persisted, notified or restarted.
- `test/subagents-output-trust.test.ts` [unit] (17 call sites) — [C69][C70] the provenance frame states the report has no user authority and indents every line.
- `test/subagents-parity-gate.test.ts` [child] (12 call sites) — the real behavior.
- `test/subagents-pi-native.test.ts` [unit] (10 call sites) — gathering snapshots every server the parent extensions registered.
- `test/subagents-preferences.test.ts` [unit] (9 call sites) — subagent preference policy: rejected policy and unknown action name the allowed choices.
- `test/subagents-process-groups.test.ts` [child] (8 call sites) — killAll SIGKILLs every tracked group and counts the owning agents.
- `test/subagents-project-trust.test.ts` [unit] (0 call sites) — a project subagentStart hook runs: $ran when the project trusted is $trusted.
- `test/subagents-prompt-assembly.test.ts` [unit] (13 call sites) — an explore prompt opens with its own text and keeps the documented section order.
- `test/subagents-rem-launcher.test.ts` [child, mocked-unit] (4 call sites) — with the subconscious flag and a populated board shutdown spawns one marked detached session.
- `test/subagents-resume-errors.test.ts` [unit] (1 call site) — $code ResumeError carries the documented name and code.
- `test/subagents-scheduler.test.ts` [unit] (17 call sites) — a sync task emits the documented event order with its provenance.
- `test/subagents-settings.test.ts` [unit] (4 call sites) — settings input %j yields the defaults without warnings.
- `test/subagents-shell-command.test.ts` [unit] (2 call sites) — a timed-out shell kills descendants holding its output pipes and completes promptly.
- `test/subagents-sidekicks.test.ts` [unit] (13 call sites) — five production sidekicks ship, each gated by its flag.
- `test/subagents-skill-loading.test.ts` [unit] (4 call sites) — a declared skill is copied into the child before its first turn.
- `test/subagents-small.test.ts` [unit] (18 call sites) — feature flags read both override variables case-insensitively.
- `test/subagents-specialized.test.ts` [unit] (5 call sites) — the specialized tools exist only when their feature flag is on.
- `test/subagents-status-line.test.ts` [unit] (10 call sites) — [C102] polling starts after 300 ms and repeats every 5 s until stopped.
- `test/subagents-stop-control.test.ts` [unit] (4 call sites) — a valid stop_task forwards the reference and publishes the stop result.
- `test/subagents-stop-deadline.test.ts` [unit] (7 call sites) — settleWithin reports a value or a missed deadline.
- `test/subagents-stop.test.ts` [unit] (6 call sites) — an unsettled worker is re-aborted, its process groups killed and its session disposed at 10000ms, and may be stopped again at 30000ms.
- `test/subagents-task-panel.test.ts` [unit] (5 call sites) — [C97] session start shows running agents from the registry snapshot.
- `test/subagents-task-registry.test.ts` [unit] (9 call sites) — registering a running node persists it and reports a registration.
- `test/subagents-task-snapshots.test.ts` [unit] (3 call sites) — a settled record becomes a completed local-agent snapshot with its model and effort split.
- `test/subagents-task-status.test.ts` [unit] (4 call sites) — $from to $to is allowed: $allowed.
- `test/subagents-task-tool.test.ts` [unit] (4 call sites) — a sync task returns the child final message verbatim.
- `test/subagents-tool-contract.test.ts` [unit] (7 call sites) — each subagent tool returns the structuredContent its outputSchema promises.
- `test/subagents-tool-mapping.test.ts` [unit] (7 call sites) — an all-tools agent inherits what the parent has and hides context tools by default.
- `test/subagents-tool-results.test.ts` [unit] (15 call sites) — a sync result is the final message verbatim.
- `test/subagents-tool-stats-boundary.test.ts` [unit] (8 call sites) — invalid nested statistics do not corrupt counters %j.
- `test/subagents-turn-limit.test.ts` [unit] (4 call sites) — turns that call no tools never count.
- `test/subagents-workflows.test.ts` [unit] (42 call sites) — $name.
- `test/support.test.ts` [unit] (15 call sites) — data results preserve ordinary JSON text and empty structured data.
- `test/task-discovery.test.ts` [child] (3 call sites) — remote launch discovery is scoped to the repository and retains branch placement.
- `test/task-outcome.test.ts` [unit] (3 call sites) — usage includes compaction and abandoned work while output follows the active leaf.
- `test/task-progress.test.ts` [unit] (6 call sites) — a tool run reports its start and end with the tools still active.
- `test/timer-bootstrap-recovery.test.ts` [real-pi, mocked-unit] (2 call sites) — recovery refuses another writer after $name without a root receipt.
- `test/timer-recovery.test.ts` [real-pi, child] (11 call sites) — restart reattaches the existing Pi root and keeps subscription identity.
- `test/timer-routine-output-schemas.test.ts` [unit] (1 call site) — CI receipts include normalized internal fields for %s.
- `test/timer-schedules.test.ts` [unit] (4 call sites) — rejects invalid timer input %j.
- `test/timer-service.test.ts` [child] (4 call sites) — a real Pi timer outlives its initiator, dedupes, then drains on cancel.
- `test/timer-tool-journey.test.ts` [child] (1 call site) — SubscribeTimer preserves an explicitly loaded provider in its independent Pi root.
- `test/timers.test.ts` [sdk-scripted, mocked-unit] (19 call sites) — listing subscriptions for an unused owner starts no process.
- `test/unit-coverage.test.ts` [unit] (14 call sites) — registerShells registers the three shell tools.
- `test/upstream-policy.test.ts` [unit] (3 call sites) — coverage policy rejects invalid report %j.
- `test/user-perspective.test.ts` [real-pi, sdk-scripted, child] (16 call sites) — user-perspective: loaded skills and prompt templates expose descriptions.
- `test/worker-errors.test.ts` [unit] (17 call sites) — native child depth blocks a nested Agent at the configured cap.
- `test/worker-review.test.ts` [unit] (5 call sites) — resume refreshes pending usage after TaskOutput claims it during startup.
- `test/worker-wait.test.ts` [unit] (5 call sites) — without a signal the completion is returned as is.
- `test/workers-native-capabilities.test.ts` [unit] (0 call sites) — uppercase workers honor native capabilities with enabled=$enabled and readonly=$readonly.
- `test/workers.test.ts` [child] (5 call sites) — restore tasks from real Pi branch entries and mark unfinished tasks interrupted.

#### `test/helpers/` (17 files; run by `test` and again by `test:helpers`)
- `test/helpers/check-plan.test.ts` [child] (16 call sites) — check-plan.mjs on a valid plan.
- `test/helpers/log.test.ts` [child] (5 call sites) — log.sh rows.
- `test/helpers/orch-cli.test.ts` [unit] (11 call sites) — orch CLI compact output prints exactly the documented lines.
- `test/helpers/orch-drain.test.ts` [mocked-unit] (1 call site) — an inbox drain whose inbox directory cannot be recreated puts the pointers back.
- `test/helpers/orch-frontier.test.ts` [unit] (2 call sites) — orch gt frontier parsing.
- `test/helpers/orch-lock.test.ts` [child] (7 call sites) — orch lock holders.
- `test/helpers/orch-store.test.ts` [unit] (15 call sites) — orch store cell and line cleaning.
- `test/helpers/orch-typecheck.test.ts` [child] (1 call site) — orch and bootstrap type-check under tsc --noEmit --strict with the helper compiler options.
- `test/helpers/overlays.test.ts` [child] (2 call sites) — every helper overlay edit is present in the shipped helper file.
- `test/helpers/source-fidelity.test.ts` [unit] (3 call sites) — portable helper retains the frozen source bytes: ${path}.
- `test/helpers/watch-pr-bootstrap.test.ts` [unit] (8 call sites) — bootstrap installs under the scripts directory, not the cwd, when the launcher runs from an unrelated directory.
- `test/helpers/watch-pr-cli.test.ts` [unit] (22 call sites) — parseArgs --stack alone selects stack mode.
- `test/helpers/watch-pr-github.test.ts` [unit] (39 call sites) — ${GhGitHubReader.name}.pullRequest runs gh pr view with the documented field list and parses the facts.
- `test/helpers/watch-pr-live.test.ts` [unit] (5 call sites) — status-only reports a merged PR successfully.
- `test/helpers/watch-pr-policy.test.ts` [unit] (39 call sites) — runQueued emits QUEUE then a sweep STATUS then COMPLETE exit 0 when every PR is merged, with a stamped envelope.
- `test/helpers/watch-pr-typecheck.test.ts` [unit] (3 call sites) — the helper typecheck script passes strict tsc over watch-pr including its four ts-expect-error assertions.
- `test/helpers/worktree-audit.test.ts` [child] (9 call sites) — worktree-audit.sh columns and buckets.

#### `skills/` (4 files; excluded by `extensions/pi-pstack/vitest.config.ts:12` and run by no gate)
- `skills/poteto-mode/scripts/orch/orch.test.ts` [unit] (14 call sites) — Store.
- `skills/poteto-mode/scripts/watch-pr/cli.test.ts` [unit] (9 call sites) — parseArgs.
- `skills/poteto-mode/scripts/watch-pr/github.test.ts` [unit] (15 call sites) — checks fallback chain.
- `skills/poteto-mode/scripts/watch-pr/policy.test.ts` [unit] (14 call sites) — readiness truth table.

### pi-anthropic-oauth

19 files, 138 call sites. Pure unit coverage of the Anthropic OAuth provider: request construction, system blocks, payload shapes, caching, token resolution, stream conversion/failures, tool-name handling. Two files use `vi.mock`; one starts a loopback server (`test/network-guard.test.ts`) to prove the guard allows localhost and blocks external URLs (`:41` expects `Blocked external network request` for `https://example.invalid/blocked`). No test spawns Pi or a child process. The skill-feature file also names manual probes (`scripts/prove-native.ts`, `scripts/prove-request-paths.ts`) that are not wired to any package script or Makefile target (`features/oauth-providers.md:37`).

All 19 files.

- `test/auth-boundaries.test.ts` [unit] (9 call sites) — the native %s token variable resolves a subscription token.
- `test/capture-provider.test.ts` [unit] (4 call sites) — captureProvider returns the one registered provider.
- `test/claude-parity.test.ts` [unit] (8 call sites) — billing derives from $name.
- `test/context-fit.test.ts` [unit] (9 call sites) — a payload under the blocking threshold is returned unchanged.
- `test/context-guard.test.ts` [unit] (15 call sites) — the guard ignores another provider.
- `test/context-tokens.test.ts` [unit] (21 call sites) — %s counts four bytes per token.
- `test/network-guard.test.ts` [local-http] (2 call sites) — a loopback request reaches the local server.
- `test/oauth-credentials.test.ts` [unit] (7 call sites) — an unexpired credential is used as stored.
- `test/payload-shape.test.ts` [mocked-unit] (1 call site) — $name gets the billing block first.
- `test/prompt-cache.test.ts` [unit] (6 call sites) — every cache breakpoint lasts one hour by default.
- `test/registration-missing-builtin.test.ts` [mocked-unit] (2 call sites) — loading fails when Pi has no anthropic provider.
- `test/registration.test.ts` [unit] (10 call sites) — the published package includes its parity reference.
- `test/request-hooks.test.ts` [unit] (7 call sites) — onPayload sees the billing block first.
- `test/request-identity.test.ts` [unit] (10 call sites) — the system lists the billing block, the preamble, then the prompt.
- `test/responses.test.ts` [unit] (12 call sites) — an ordinary text reply becomes one text block.
- `test/stream-failures.test.ts` [unit] (7 call sites) — an overflow response ends as an error.
- `test/tool-name-collision.test.ts` [unit] (4 call sites) — a tool set that differs only in case still sends unique tool names.
- `test/tool-transitions.test.ts` [unit] (4 call sites) — case-folded custom names outside the canonical alias list retain first-active dispatch.
- `test/unicode-stream.test.ts` [unit] (0 call sites) — $name split across chunks arrives whole.

### pi-antigravity-oauth

11 files, 145 call sites. Pure unit coverage of the Google Antigravity provider: login URL construction, Cloud Code transport parsing, model catalog/registration, header and option estimation, constrained sampling, message transforms, retry behavior, streaming. One loopback-server guard test. No subprocess, no real Pi.

All 11 files.

- `test/cloudcode.test.ts` [unit] (16 call sites) — postCloudCode parses a successful JSON body.
- `test/command.test.ts` [unit] (10 call sites) — the account summary shows email, project, paid tier, and the quota groups the CLI reads.
- `test/constrained-sampling.test.ts` [unit] (9 call sites) — strict schemas require every field while preserving caller input.
- `test/estimate-options.test.ts` [unit] (12 call sites) — header conversion uses normalized native header names.
- `test/google-shared.test.ts` [unit] (17 call sites) — Google wire capabilities follow model families: $id.
- `test/models.test.ts` [unit] (11 call sites) — the extension registers the Google Antigravity subscription provider and command.
- `test/network-guard.test.ts` [local-http] (2 call sites) — a loopback request reaches the local server.
- `test/oauth.test.ts` [unit] (18 call sites) — login sends the Antigravity CLI authorization URL.
- `test/provider-retry.test.ts` [unit] (6 call sites) — requests return their value without retry configuration.
- `test/stream.test.ts` [unit] (37 call sites) — unsigned text omits the optional SDK signature field.
- `test/transform-messages.test.ts` [unit] (7 call sites) — non-vision models replace adjacent images with one placeholder.

### pi-xai-oauth

7 files, 71 call sites. Pure unit coverage of the Grok Build provider: catalog parsing/refresh, registration, request shape, streaming, network guard (loopback server). No subprocess. The `live-catalog` name is misleading: it constructs a request fixture and asserts the bearer token is sent; it does not run a live refresh.

All 7 files.

- `test/catalog.test.ts` [unit] (30 call sites) — the live-shaped body parses to the four served model ids.
- `test/live-catalog.test.ts` [unit] (9 call sites) — the refresh sends the bearer token to the catalog endpoint.
- `test/network-guard.test.ts` [local-http] (2 call sites) — a loopback request reaches the local server.
- `test/provider.test.ts` [unit] (13 call sites) — the registered provider is Grok Build.
- `test/registration.test.ts` [unit] (2 call sites) — the default export is a Pi extension factory.
- `test/request.test.ts` [unit] (10 call sites) — the client version is the one the contract was measured against.
- `test/stream.test.ts` [unit] (5 call sites) — native streaming sends one request to the responses endpoint.

### pi-caveman

22 files, 280 call sites. Mostly unit: mode transitions, state, config, stats, rulesets, parse/compress helpers, tool registration, hook differential. `test/package-runtime.test.ts` is the one end-to-end: it spawns the vendored real Pi CLI (`node_modules/@earendil-works/pi-coding-agent/dist/cli.js`) with a local stub OpenAI-compatible server and stub Caveman MCP, asserting `/w/pi` routing and the completion path. `test/cavecrew-process.test.ts` spawns node stubs, not Pi. Platform skips: `compress/compress.test.ts:202,297`, `compress/lock.test.ts:69,77`, `compress/paths.test.ts:44,50`, `compress/io.test.ts:71` (win32/root/permission bits). Note: `make verify` has no target that runs this suite; only root `bun run --filter '*' test` (`package.json:23`) or a direct filter does. The package also ships unwired e2e scripts requiring external Caveman binaries and a pinned checkout: `e2e:real` (`--cli`/`--bin` dirs, `/tmp/caveman`), `check:parity` (`CAVEMAN_CHECKOUT`, default `/tmp/caveman`), `e2e:contract` (real Pi print mode plus a real model), `test:runtime` (vendored upstream runtime).

All 22 files.

- `test/cavecrew-process.test.ts` [unit] (7 call sites) — collect.
- `test/cavecrew.test.ts` [unit] (12 call sites) — crewModel.
- `test/commands.test.ts` [unit] (18 call sites) — session_start.
- `test/compress/compress.test.ts` [cond] (27 call sites) — empty input refused without calling the model.
- `test/compress/detect.test.ts` [unit] (11 call sites) — detectFileType.
- `test/compress/io.test.ts` [cond] (15 call sites) — firstInvalidUtf8Offset handles $label.
- `test/compress/lock.test.ts` [cond] (11 call sites) — lockPathFor is a 16-hex digest under locks.
- `test/compress/paths.test.ts` [cond] (3 call sites) — sensitive directory %s is blocked.
- `test/compress/py.test.ts` [unit] (13 call sites) — pyRepr renders $input as $repr.
- `test/compress/text.test.ts` [unit] (32 call sites) — splitFrontmatter separates an LF frontmatter block.
- `test/compress/validate.test.ts` [unit] (43 call sites) — indented fence (#820).
- `test/config.test.ts` [unit] (10 call sites) — getDefaultMode.
- `test/extension.test.ts` [unit] (20 call sites) — session_start.
- `test/hook-differential.test.ts` [unit] (1 call site) — input.
- `test/modes.test.ts` [unit] (0 call sites) — canonicalMode.
- `test/package-runtime.test.ts` [real-pi, child, local-http] (5 call sites) — an open gate routes the first request through /w/pi.
- `test/parse.test.ts` [unit] (5 call sites) — upstream mode-activation corpus.
- `test/ruleset.test.ts` [unit] (7 call sites) — shipped skills.
- `test/runtime.test.ts` [unit] (5 call sites) — the package owns the runtime when the CLI manages none.
- `test/state.test.ts` [unit] (13 call sites) — one-shot modes.
- `test/stats.test.ts` [unit] (12 call sites) — sessionUsage.
- `test/tools.test.ts` [mocked-unit] (10 call sites) — caveman_compress tool.

### pi-s50

20 files, 216 call sites. Unit tests use fakes and fixed clocks (authorization, completion rules, contract, evidence, gates, policy, redaction, registry, review, scheduler, seams, skill docs, transitions). Integration tests run the real command layer in-process against real temp git repos/worktrees (`test/integration/host.test.ts`, `persistence.test.ts`, `worktrees.test.ts`, `cli-commands.test.ts`, `extension.test.ts`), with network fetched text injected. `test/e2e/flows.test.ts` is an in-process full-flow harness with a fake skill runtime. `test/e2e/cli.test.ts` is the only file that spawns the product CLI (`spawnSync(process.execPath, [src/cli/main.ts, ...])`, `:26-28`) against real temp repos. One conditional live case: `test/integration/host.test.ts:83-89` runs only with `S50_LIVE=1` and performs a live registry refresh (network). `verify-s50-harness` (Makefile:49-50) additionally needs a real `pi` binary, a configured model, and network.

All 20 files.

- `test/e2e/cli.test.ts` [child] (2 call sites) — s50 CLI process.
- `test/e2e/flows.test.ts` [unit] (4 call sites) — e2e scenarios.
- `test/integration/cli-commands.test.ts` [unit] (23 call sites) — registry commands.
- `test/integration/extension.test.ts` [unit] (18 call sites) — Pi registers exactly one s50 command with one s50 tool.
- `test/integration/host.test.ts` [cond] (3 call sites) — preflight detects languages, test commands, build commands.
- `test/integration/persistence.test.ts` [unit] (18 call sites) — .s50 persistence.
- `test/integration/worktrees.test.ts` [unit] (2 call sites) — a worktree whose directory was deleted is recreated.
- `test/unit/authorization.test.ts` [unit] (0 call sites) — gated shell commands.
- `test/unit/completion-rules.test.ts` [unit] (11 call sites) — PR_READY needs something to prove.
- `test/unit/contract.test.ts` [unit] (24 call sites) — clarification frontier.
- `test/unit/evidence.test.ts` [unit] (7 call sites) — evidence records.
- `test/unit/gates.test.ts` [unit] (13 call sites) — reserved records.
- `test/unit/policy.test.ts` [unit] (13 call sites) — invocation policy.
- `test/unit/redaction.test.ts` [unit] (1 call site) — keeps an ssh git user.
- `test/unit/registry.test.ts` [unit] (18 call sites) — top-50 eligibility.
- `test/unit/review.test.ts` [unit] (23 call sites) — findings.
- `test/unit/scheduler.test.ts` [unit] (10 call sites) — graph construction.
- `test/unit/seams.test.ts` [unit] (20 call sites) — seam confirmation.
- `test/unit/skill-docs.test.ts` [unit] (1 call site) — the skill references show at least one command per file.
- `test/unit/transitions.test.ts` [unit] (5 call sites) — legal transitions.

### pi-tui-skin

13 files, 157 call sites. Rendering/unit coverage with fake Pi/UI objects: activity strings, chrome, editor, formatting, entry-point registration, install UI, lifecycle, native renderer preservation, presentation store, theme roles, theme loading, tool renderers, and a renderer fuzz suite. No test spawns a process; nothing runs a real terminal. The live TUI matrix and randomized sessions live in the unwired scripts `check:smoke` (`scripts/tmux-smoke.mjs --all`, tmux + real Pi), `sweep`/`sweep:fast` (`scripts/ui-sweep.mjs`, tmux + real Pi), and `check:reference`/`check:reference:capture` (reference comparison), only reachable through `make sweep-tui-skin` or direct scripts.

All 13 files.

- `test/activity.test.ts` [unit] (14 call sites) — describeActivity.
- `test/chrome.test.ts` [unit] (10 call sites) — header.
- `test/editor.test.ts` [unit] (21 call sites) — SkinStyleEditor.
- `test/format.test.ts` [unit] (25 call sites) — formatElapsed.
- `test/index.test.ts` [unit] (8 call sites) — tui-skin extension entry point.
- `test/install-ui.test.ts` [unit] (13 call sites) — install-ui controller.
- `test/lifecycle.test.ts` [unit] (6 call sites) — registerLifecycle.
- `test/native-renderers.test.ts` [unit] (2 call sites) — Pi preserves the selected tool set %j.
- `test/renderer-fuzz.test.ts` [unit] (14 call sites) — call row: ${renderer.name}.
- `test/store.test.ts` [unit] (12 call sites) — presentation store.
- `test/theme-roles.test.ts` [unit] (4 call sites) — theme role coverage.
- `test/theme.test.ts` [unit] (5 call sites) — tui-skin theme.
- `test/tool-renderers.test.ts` [unit] (23 call sites) — tui-skin tool renderers.

### pi-one-dark-pro-theme

5 files, 82 call sites. `theme.test.ts` is unit coverage of scope resolution; `parity.test.ts` and `upstream.test.ts` verify the vendored upstream artifact/provenance (spawn the real parity checker and pin bytes); `upstream-cli.test.ts` runs the real `scripts/check-parity.mjs` against a fixture package and expects tamper rejection. `theme-loader.test.ts:20,32,93` self-skips two suites unless the vendored Pi install exists (devDependency absent). The live terminal check is `check:smoke` (`scripts/tmux-smoke.mjs`, tmux + real Pi), not run by `make verify`.

All 5 files.

- `test/parity.test.ts` [child] (14 call sites) — upstream pin.
- `test/theme-loader.test.ts` [cond] (5 call sites) — theme loader through the vendored pi copy.
- `test/theme.test.ts` [unit] (46 call sites) — resolveScope.
- `test/upstream-cli.test.ts` [child] (7 call sites) — the real checker verifies both original provenance and the formatted artifact.
- `test/upstream.test.ts` [child] (10 call sites) — the authentic original retains its byte count and published pin.

### Repository root

- Python: 11 files, 134 `def test_` cases under `skills/doctor/tests` (3 files, 56 cases), `skills/implement-cli-from-contract/tests` (2 files, 20 cases), and `skills/reverse-engineer-cli/tests` (6 files, 58 cases). They are local unittest suites that exercise the skill scripts, including through `subprocess` (e.g. `skills/doctor/tests/test_boundaries.py`), against temp directories; no network is evident. Run by `verify-python` via `uv` with `coverage==7.16.1`.
- Script self-tests: 8 `*.selftest.mjs` files. Wired into package scripts: `check-agents-compliance.selftest.mjs` (`package.json:24`), `check-vitest-conventions.selftest.mjs` (`:25`), `check-bun-toolchain.selftest.mjs` (`:26`), `typescript-policy.selftest.mjs` plus `check-typescript-policy.selftest.mjs` (`:29`), `format-write.selftest.mjs` (`:32`). Orphaned (referenced by no Makefile target or package script): `scripts/typescript-source.selftest.mjs`, `scripts/migrate-index-signature-access.selftest.mjs`.
- Static gates are not tests but do assert repository invariants: `scripts/check-pi-mechanisms.mjs`, `scripts/check-agents-compliance.mjs`, `scripts/check-bun-toolchain.mjs`, `extensions/scripts/check-vitest-conventions.mjs`, `scripts/typescript-policy.mjs`.
- No root-level Vitest project exists; root `test` merely fans out to workspaces (`package.json:23`).

Python unittest files (counts are `def test_` cases):

- `skills/doctor/tests/test_boundaries.py` — 37 cases — Regression coverage for inventory filesystem and process boundaries
- `skills/doctor/tests/test_inventory.py` — 13 cases — Inventory uses parsed session records and respects project boundaries
- `skills/doctor/tests/test_review_regressions.py` — 6 cases — Regressions for the independent doctor remediation review
- `skills/implement-cli-from-contract/tests/test_differential.py` — 11 cases — test failed launches cannot be reported as matching
- `skills/implement-cli-from-contract/tests/test_outcomes.py` — 9 cases — test new outcome failures cannot match
- `skills/reverse-engineer-cli/tests/test_capture.py` — 14 cases — test stream outcome data annotation names immutable bytes
- `skills/reverse-engineer-cli/tests/test_lifecycle.py` — 10 cases — test partial capture allocation closes prior pipe
- `skills/reverse-engineer-cli/tests/test_replay.py` — 15 cases — test invalid reviewed corpora fail before any replay output
- `skills/reverse-engineer-cli/tests/test_structure.py` — 2 cases — test maintained scripts and tests obey nesting limit
- `skills/reverse-engineer-cli/tests/test_structure_compatibility.py` — 3 cases — test structure checker supports python without try star
- `skills/reverse-engineer-cli/tests/test_tools.py` — 14 cases — test streams stdin files and repeated ids preserve evidence

Script self-tests:

- `scripts/check-agents-compliance.selftest.mjs`
- `scripts/check-bun-toolchain.selftest.mjs`
- `scripts/check-typescript-policy.selftest.mjs`
- `scripts/format-write.selftest.mjs`
- `scripts/migrate-index-signature-access.selftest.mjs`
- `scripts/typescript-policy.selftest.mjs`
- `scripts/typescript-source.selftest.mjs`
- `extensions/scripts/check-vitest-conventions.selftest.mjs`

## Gate commands

`make verify` (Makefile:3) aggregates: `verify-s50`, `verify-lint`, `verify-agents`, `verify-mechanisms`, `verify-toolchain`, `verify-test-conventions`, `verify-extension`, `verify-oauth`, `verify-tui-skin`, `verify-one-dark-pro-theme`, `verify-install`, `verify-python`.

| Target | Runs | Requirements beyond bun/node |
| --- | --- | --- |
| `verify-lint` (Makefile:5-6) | `bun run ci` → `biome ci . --error-on-warnings` (`package.json:33`) | none |
| `verify-agents` (Makefile:8-9) | agents-compliance selftest + check (`package.json:24`) | none (static scan) |
| `verify-mechanisms` (Makefile:11-12) | `node scripts/check-pi-mechanisms.mjs` | installed `extensions/pi-pstack/node_modules/@earendil-works/pi-coding-agent/dist` |
| `verify-toolchain` (Makefile:14-15) | bun-toolchain selftest + check | bun |
| `verify-test-conventions` (Makefile:17-18) | vitest-conventions selftest + check | none |
| `verify-extension` (Makefile:20-27) | pi-pstack `check:resources`, `check:native-first`, `check:parity`, `typecheck`, `test:coverage`, `test:helpers`, `check:journeys` | `check:journeys` spawns the vendored real Pi bundle in RPC mode with the scripted journey provider (`scripts/verify-journeys.mjs:15`, `scripts/journey-client.mjs:118-125`); no model/network needed |
| `verify-parity-audit` (Makefile:29-32) | pi-pstack `check:native-parity -- --allow-external` | **excluded from `verify`**: "checks provenance against ~/src/experiments/plugins and its git history" (Makefile:29-30), plus `~/.upstream/skills-reference` (`scripts/check-native-parity.mjs:16`) |
| `verify-oauth` (Makefile:34-41) | typecheck + `test:coverage` for anthropic, antigravity, xai; antigravity `check:vendor` | none online; `check:vendor` compares against installed node_modules |
| `verify-s50` (Makefile:43-44) | `typecheck` + `test:coverage` | `S50_LIVE` unset means the live network case is skipped |
| `verify-s50-harness` (Makefile:47-50) | `node extensions/pi-s50/scripts/verify-pi-harness.mjs` | **excluded**: "Needs a real pi binary, a configured model, and network access" (Makefile:47); installs pi-s50 into a throwaway project |
| `verify-tui-skin` (Makefile:52-54) | `check:skin`, `typecheck`, `test:coverage` | none; the live matrix is not included |
| `sweep-tui-skin` (Makefile:57-61) | full `ui-sweep` (unit gate + live TUI matrix + seeded fuzz) | **excluded**: "Needs tmux and a real pi binary" (Makefile:57) |
| `verify-one-dark-pro-theme` (Makefile:63-66) | `check:parity`, `typecheck`, `test:coverage` | vendored upstream artifact + local biome; no tmux/network |
| `verify-install` (Makefile:68-69) | `node scripts/verify-fresh-install.mjs` | git working tree export; spawns vendored Pi bundle for `--list-models` and RPC `get_commands` with fixture credentials |
| `verify-python` (Makefile:71-79) | `uv run --with coverage==7.16.1` unittest for three skill test dirs, combine, report, and assert every `skills/*/scripts/*.py` is measured | uv; network unless the coverage wheel is cached |

Verification scripts that exist but are not reachable from `make verify` at all:

- pi-pstack `check:cli` (`package.json:55`) — real vendored Pi RPC smoke (`scripts/verify-cli.mjs:39-45`).
- pi-pstack `check:progress-tui` (`package.json:57`) — tmux + `PI_BIN`/PATH `pi` (`scripts/verify-progress-tui.mjs:22,35-37`).
- pi-pstack `check:latest-source` (`package.json:54`) — defaults to `~/src/experiments/plugins` and its pinned commit (`scripts/check-latest-source.mjs:11,15-21`).
- pi-pstack `check:upstream` (`package.json:60`) — copies vendored scripts to a temp dir, runs `bun install --frozen-lockfile` and bun test with coverage (`scripts/verify-upstream.mjs:44-55`).
- pi-pstack `check:journeys:no-workers` (`package.json:58`).
- pi-caveman: the entire package. Its vitest suite and every script (`test:runtime`, `e2e:real`, `e2e:contract`, `check:parity`, `check:parity:final`) are absent from the Makefile. `e2e:real` requires external `caveman`/`caveman-proxy` binaries and a checkout (`scripts/e2e-real.mjs:11-24`); `check:parity` requires `CAVEMAN_CHECKOUT` (default `/tmp/caveman`, `scripts/check-parity.mjs:11`); `e2e:contract` runs real Pi print mode against a real model (`scripts/response-contract.mjs:1-3`).
- pi-tui-skin `check:smoke`, `sweep:fast`, `check:reference`, `check:reference:capture` (`package.json:15-19`).
- pi-one-dark-pro-theme `check:smoke` (`package.json:24`) — tmux + real Pi (`scripts/tmux-smoke.mjs:3-12`).
- Root `typecheck` (`package.json:30`: types-policy selftests + root `tsc --noEmit` + per-workspace typecheck) and `check:write` (`package.json:32`) are not invoked by any Makefile target; `check:types-policy` and `format-write.selftest.mjs` therefore only run when invoked manually.
- Manual probes not wired anywhere: `extensions/pi-anthropic-oauth/scripts/prove-native.ts`, `prove-request-paths.ts`, `prove-context-guard.ts`, `prove-pi.ts`, `equivalence.ts` (feature doc at `features/oauth-providers.md:37` acknowledges them; no script or Makefile reference was found).
- CI is a narrower subset than `make verify`: `.github/workflows/pi-pstack.yml:22-26` runs only `check:resources`, `check:parity`, `typecheck`, `test` for pi-pstack path changes.

## Gaps a user-perspective program must fill

1. No terminal (TUI) driving anywhere in `control-pi`. Todo widget, status line, task panel, model picker, dialogs, and all theme rendering are untested from the user's seat. The repo has tmux harnesses (`pi-tui-skin/scripts/tmux-smoke.mjs`, `pi-one-dark-pro-theme/scripts/tmux-smoke.mjs`, `pi-pstack/scripts/verify-progress-tui.mjs`) but they are excluded from `make verify` and not integrated with `control-pi`.
2. No interactive dialog bridge in `control-pi`. Select/confirm/input/permission flows (e.g. pstack setup, routine activation, AskQuestion, tool permission asks) cannot be answered; the repo's `journey-client.mjs` bridge exists but is not exposed through the harness.
3. No restart/persistence verification. `--no-session` and disposable scratch dirs mean Poteto mode restoration, branch state, timers, subscriptions, and session resume are all unverified by `control-pi`.
4. No OAuth login flow coverage. Fixture credentials prove model listing only; device/browser login, callback handling, token refresh/expiry, revocation, and ambient-token resolution are untested end to end.
5. No provider failure-path coverage. Timeout, 4xx/5xx, rate limits, context overflow, retry/backoff, cancellation, and stream truncation are exercised only by unit tests with synthetic streams, never through a real Pi session with a failing provider.
6. No real inference or streaming UX coverage. No drive makes a model call, so cost/usage display, thinking blocks, tool-call rendering, and cancellation UX are unverified.
7. No theme coverage in the harness. `pi-tui-skin` and `pi-one-dark-pro-theme` are absent from `control-pi`; the only non-unit theme checks need tmux and are not in `make verify`.
8. Empty-state bias in the pstack drive. Only `Todos: none.` is asserted; populated todo lists, the status todo summary, and the eight-item widget window are uncovered (`features/pstack-status.md:33,40`).
9. Half of the Poteto mode story. Only `/poteto-mode off` is driven; activation, `/skill:poteto-mode` interception, the direct `pstack_mode` tool, and per-mode prompt injection are untested by `control-pi` (`features/poteto-mode.md:33`).
10. Standalone skills are registration-only. No workflow is invoked, and the five skills' Python behavior is tested only by local unittests in `verify-python`, not through Pi.
11. Large swaths of pi-pstack user surface have no harness drive: timers/subscriptions, routines and their webhook relay, subagent Task/TaskOutput/TaskMessage, cloud/remote placement, journey workflows, prompt templates, and auto-compaction. Only the four feature docs are driven.
12. Package coverage holes in the gate itself: pi-caveman's 280 vitest cases run only if someone invokes root `bun run --filter '*' test`; the four pi-pstack skill-level files (52 call sites) are excluded by `vitest.config.ts:12` and run nowhere; two script selftests are orphaned; root `typecheck`/types-policy and `check:write` are not in `make verify`.
13. Assertion gaps in `control-pi` evidence: drives assert on captured messages/notifications/entries but do not assert Pi exit behavior or stderr cleanliness (only `doctor` looks at startup), do not check for leaked child processes beyond their own handle, and the OAuth drive is documented for Claude/Antigravity only (`features/oauth-providers.md`) while the script also tests xai — the doc/script contract has drifted.
14. Error and edge UX gaps: malformed settings/auth, unsupported platforms (the fs-sandbox fallback rejection at `scripts/filesystem-launch.mjs:21-22`), missing binaries, and permission-denied paths are covered only by unit tests.
15. No end-to-end install/upgrade UX through the real `pi install` path in the default gate; `verify-s50-harness` is the only target that installs into a throwaway project and it is excluded (`Makefile:47-50`).
