# AGENTS.md audit of pi-caveman

This audit checks every file that branch `feat/pi-caveman` adds against the root `AGENTS.md` and `extensions/AGENTS.md`. Each row names the rule, the verdict, and the evidence or fix. File groups: **mode** (`src/modes.ts`, `parse.ts`, `config.ts`, `state.ts`, `ruleset.ts`, `controller.ts`), **commands** (`commands.ts`, `renderers.ts`, `stats.ts`), **tools** (`cavecrew.ts`, `cavecrew-tool.ts`, `compress-tool.ts`, `src/compress/*`), **resources** (`skills/`, `overrides/`, `agents/`, `prompts/`), **scripts** (`scripts/*.mjs`), and **tests** (`test/`).

## Root AGENTS.md

| Rule | Verdict | Evidence or fix |
|---|---|---|
| Think before coding: state assumptions, surface tradeoffs | Compliant | The scope boundary (proxy, engine, browse, MCP, and cloud are out of scope) and every upstream divergence are written down in `README.md`. |
| Simplicity first: no speculative features or configurability | Compliant | Config sources and env vars are the upstream ones. Nothing beyond upstream behavior was added except the Pi mappings below. |
| Surgical changes | Compliant | Outside the package, only the root `README.md` row and `bun.lock` changed. |
| Goal-driven execution: verifiable success criteria | Compliant | The upstream differentials, `vitest`, and `scripts/rpc-smoke.mjs` are the criteria. |
| Context-window and algorithm efficiency | Compliant | Parsing and attribution are linear. `aggregateHistory` keeps one map entry per session. |
| Immutability: never mutate inputs | Fixed | `validateX` used to push into a passed `Findings` object. It now returns its own errors and warnings. `accumulate` used to write into its `run` argument. It now returns a new `CrewProgress`. No function writes to a parameter (`check:agents` reports 0 `parameter-mutation`). Local accumulators that a function creates and returns are not shared state. `event.systemPromptOptions.sections` is written in place because that is Pi's documented `before_agent_start` contract (see the native-gap table). The controller's `state` binding is the session's mode state. It is rebound to new immutable `ModeState` values and never mutated. |
| Many small files, 200–400 lines typical, 800 max | Fixed | `compress.ts` was 541 lines. It is now split into `compress.ts`, `io.ts`, `lock.ts`, `paths.ts`, `text.ts`, and `validate.ts`. The largest source file is now under 320 lines. |
| Comprehensive error handling | Fixed | Every `catch` either rethrows with context, returns a failed outcome, or carries a comment that names the tolerated failure and its documented fallback. User-facing errors name the failing path or argument without leaking secrets. |
| Input validation with a schema | Fixed | TypeBox is the repository's schema library. Tool parameters are TypeBox schemas with `minLength`. Config files, session entries, history rows, assistant usage, and cavecrew JSON events are parsed with `Check` against `src/schemas.ts`. These replaced hand-written reflective guards. |
| Functions under 50 lines | Fixed | `caveman()`, `runCrew`, `compressFileLocked`, `extractIndentedCodeBlocks`, `startPi`, and one test `describe` callback were split. `check:agents` reports 0 `function-length` findings. |
| Nesting at most 4 levels | Fixed | `extractIndentedCodeBlocks` was flattened. `check:agents` reports 0 `nesting-depth` findings. |
| No `as` casts or `any` in source | Fixed | `modes.ts` narrowed with `(X as readonly string[]).includes`. It now uses `ReadonlySet` lookups. No `as` cast or `any` remains under `src/`. |
| No `console.log` | Compliant | No `console.*` calls. The scripts write through `process.stdout`. |
| No hardcoded values | Compliant | Limits and constants are named (`MAX_OUTPUT_CHARS`, `KILL_GRACE_MS`, `MAX_RETRIES`, `LOCK_WAIT_SECONDS`). Paths come from Pi or XDG resolution. |
| 80% coverage | Compliant | `vitest --coverage` measures statements 95.7%, branches 88.3%, functions 97.5%, and lines 96.4% over 437 tests. |
| Test-driven workflow | Compliant | Every fix in this audit landed with a regression test, for example the backup cleanup on a thrown fix call, the steer notice drop, the pre-aborted cavecrew run, and the dot-directory refusal. |
| Edge cases: null, empty, invalid types, boundaries, errors | Fixed | Added `modes.test.ts` (null, undefined, number, prototype key), `ruleset.test.ts` (missing skills directory), the `MAX_FILE_SIZE` boundary, empty and whitespace input, invalid UTF-8, malformed history and JSON lines, and missing binaries. |
| Test quality: independent, behavior names, mocks only at boundaries | Fixed | Tests named with "and" were split. Developer-filesystem paths now use temporary directories. The only module mock is `runCrew`, the process boundary of the `cavecrew` tool. `collect` itself is tested against real Node child processes. |
| Security: no secrets, errors don't leak | Fixed | No secrets in the source. Upstream's sensitive-path check compares dot-stripped names against `.ssh`, `.aws`, `.gnupg`, `.kube`, and `.docker`, so those directories never matched. `paths.ts` now also compares raw names, so files under them are refused before their contents reach a model. This is the one intentional divergence from upstream. It only makes refusal stricter. |
| SQL injection, XSS, CSRF, rate limiting | Not applicable | The package has no database, HTML output, or network endpoint. |
| Vitest: `test.for`, shallow `describe`, no `.only` | Compliant | `check:tests` reports 0 violations and 0 review items for this package. |
| Vitest: fake timers when time is the dependency | Fixed | The two lock-wait tests that slept 50 ms now use `vi.useFakeTimers` or an explicit `abort`. |
| Vitest: `vi.mock(import(...))` form, env cleanup | Compliant | `vi.mock(import('../src/cavecrew.ts'), …)`. Every `vi.stubEnv` is undone with `vi.unstubAllEnvs` in `afterEach`. |
| Vitest: precise assertions, no weak matchers | Compliant | `check:tests` enforces the weak-matcher list. Assertions compare literal values. |

## extensions/AGENTS.md

| Rule | Verdict | Evidence or fix |
|---|---|---|
| Pi-native first, least powerful mechanism | Compliant | Skills ship as a Pi package resource. Prompt templates provide `/caveman-commit`, `/caveman-review`, `/caveman-compress`, and `/caveman-init`. State uses `pi.appendEntry`. Prompt changes use `systemPromptOptions.sections`. The badge uses `ctx.ui.setStatus`. Model calls use `ctx.modelRegistry.streamSimple`. |
| Source of truth: installed Pi version and exported types | Compliant | Built against the installed `@earendil-works/pi-coding-agent` 1.0.4 declarations and verified live on Pi 1.0.4. Upstream's runtime suite pins pi-ai 1.0.2; `scripts/test-runtime.mjs` admits 1.0.4 only through the file-level review in `scripts/sdk-review.json`. No private import paths are used. |
| Native-gap gate for custom logic | Compliant | See the native-gap table below. |
| Factory registers only; no session resources in the factory | Compliant | The factory only registers handlers, commands, tools, and renderers. Child processes start inside `cavecrew` tool calls and end with them. |
| Reconstruct branch state from `getBranch()` on `session_start` | Compliant | `controller.ts` restores from `ctx.sessionManager.getBranch()` on `session_start` and `session_tree`, and clears pending notices on both. |
| Prompt changes through structured options, not `systemPrompt` replacement | Compliant | Only `systemPromptOptions.sections['caveman']` is set. The whole prompt is never replaced. |
| `input` and queued input semantics | Fixed | Queued steer and follow-up text never reaches `before_agent_start`, so its notice is now dropped instead of leaking into a later turn. The mode change itself still applies, as upstream applies it per submitted prompt. |
| Tools: TypeBox params, `details`, `outputSchema` with `structuredContent` for data | Fixed | `cavecrew` and `caveman_compress` now declare `outputSchema` and return matching `structuredContent`, with `details: undefined`. |
| Tools: report nested model usage | Fixed | `caveman_compress` sums the usage of every `streamSimple` call and returns it as `usage`. `cavecrew` returns the subagent's summed usage. |
| Tools: throw for failure | Compliant | A failed compression or a failed subagent throws with the reason. |
| Tools: bounded model-facing output | Compliant | `cavecrew` truncates at 50,000 characters. Compress results are one line. |
| File mutation through `withFileMutationQueue` | Fixed | `compressFile` runs its whole read-modify-write inside `withFileMutationQueue`. The cross-process lock stays inside it (see the native-gap table). |
| Sequential execution for shared mutable state | Compliant | `caveman_compress` sets `executionMode: 'sequential'`. |
| Annotations when accurate | Fixed | Both tools declare `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, and `openWorldHint: true`. |
| Cancellation for blocking and nested work | Fixed | `runCrew` refuses an already-aborted signal before it spawns. An abort sends SIGTERM to the child's process group, then SIGKILL after `KILL_GRACE_MS`. Compression passes the tool signal to every model call and to the lock wait. |
| Message renderer for displayed custom content | Fixed | `renderers.ts` registers Markdown renderers for `caveman-stats` and `caveman-help`. |
| Terminal UI through `ctx.ui` primitives | Compliant | Only `setStatus` and `notify` are used. No custom components. |
| Behavior independent of rendering; RPC, JSON, and print modes | Compliant | The RPC smoke run exercises every command and tool without a TUI. |
| Model calls through `ctx.modelRegistry` | Compliant | `compress-tool.ts` uses `streamSimple`. There is no direct provider HTTP. |
| Packaging: host packages as `*` peers, not bundled | Fixed | `@earendil-works/pi-ai`, `pi-coding-agent`, `pi-tui`, and `typebox` are `*` peer dependencies and pinned dev dependencies. The package has no runtime dependencies. |
| Security: no secret or payload logging | Compliant | Nothing is logged. Subagent stderr is trimmed to the last 4,000 characters and returned only on failure. |
| Verification workflow | Compliant | Targeted tests, the type check, `biome ci`, `check:agents`, `check:tests`, `check:toolchain`, `check:types-policy`, `check-pi-mechanisms`, the upstream differentials, and `rpc-smoke.mjs` all pass. |
| Hard bans: no second agent loop, transcript mutation, unconditional continuation, or bundled host packages | Compliant | `cavecrew` runs a separate Pi process through Pi's JSON mode. It does not run a loop inside this session. No continuation is requested. |
| Maintainability: delete custom code when Pi adds a native path | Compliant | Each native-gap row names its deletion condition. |
| MCP, providers, virtual models, codemode | Not applicable | The package registers none of these. |

## Parity with upstream

These checks compare the port against the upstream sources at `99aafe1`. They were run against a local upstream checkout and are not committed.

| Behavior | Check | Result |
|---|---|---|
| Mode parsing | `parseModeChange` against upstream `caveman-parse.js` on 80,000 random prompts under four default modes | 0 mismatches |
| Mode state | The state machine against the real upstream `caveman-mode-tracker.js` hook over 1,250 prompt steps | 0 mismatches |
| Stats | `attributeByMode`, `formatStats`, `formatShare`, and `formatHistory` against `caveman-stats.js` | 0 mismatches |
| Compress validation | `validate` against upstream `validate.py` on 600 mutated fixture pairs | 0 mismatches |
| File detection | `detectFileType`, `shouldCompress`, and `isSensitivePath` against `detect.py` and `compress.py` on 133 path and content cases | 0 mismatches |
| Compress flow | `compressFile` against `compress_file` with the same model replies on the 5 upstream fixtures, passing and failing | 0 mismatches in outcome, written bytes, and model call count |

An independent review found three more gaps. All three are now resolved:

- **Typed status requests.** A status request that reaches the `input` handler now tells the model to relay `Caveman mode: <mode>` verbatim and skips the reminder for that turn, as the upstream tracker does.
- **Cavecrew `model: haiku`.** The agent's `model:` hint is now honored when Pi has a matching model, after `CAVECREW_<ROLE>_MODEL` and before the session model.
- **Ruleset timing.** Upstream sends the ruleset at session start and on a mode switch. Pi carries it in the system prompt on every request. This is Pi's structured prompt mechanism, and the README records the difference.

## Native-gap gate answers

| Custom logic | Required behavior | Pi mechanism evaluated | Why it cannot express it | Why omission is unacceptable | Smallest adapter | Pi-owned authority | Verification | Delete when |
|---|---|---|---|---|---|---|---|---|
| `cavecrew` child `pi --mode json` process | Upstream cavecrew subagents run in an isolated context and return compressed output | `ctx.executeTool`, codemode, and the SDK | Pi 1.0.x has no public subagent API. JSON mode is the documented one-shot host boundary. | Cavecrew is an upstream feature that the parity requirement includes. | `collect()` spawns Pi in JSON mode and reads `message_end` events. | The child Pi owns its own loop, tools, and session. The parent reports usage through the tool result. | `cavecrew-process.test.ts` and the live smoke `cavecrew` check | Pi ships a public subagent or child-session API. |
| Cross-process lock file in `lock.ts` | Two processes must not compress the same file at once, as upstream's `fcntl` lock guarantees | `withFileMutationQueue` | The queue serializes only tools in one Pi process. | Concurrent rewrites can lose the original file. | An `O_EXCL` lock file with stale-PID reclaim, inside the queue | Pi's queue still orders in-process writers. | `lock.test.ts` | Pi's mutation queue spans processes. |
| In-place write to `systemPromptOptions.sections` | Inject the active ruleset every request | `before_agent_start` result fields | The structured path is mutation by contract. The only result field replaces the whole prompt, which the hard bans forbid. | Without the ruleset there is no caveman mode. | One assignment per run | Pi rebuilds the options each run and records the transcript delta. | `extension.test.ts` prompt-injection tests and the smoke checks | Pi adds a structured section result field. |
