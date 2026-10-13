# Independent architecture review — uncommitted pi-pstack changes

## Scope and method

Reviewed the working-tree changes under `extensions/pi-pstack`, including untracked `src/readonly-shell.ts`, `src/task/card.ts`, and their tests. Read root instructions and `extensions/AGENTS.md`. No implementation files were edited. No proprietary source was inspected. API evidence comes from the public installed Pi 1.2.0 package, its exported declarations, official documentation, and checked examples; the package manifest confirms version `1.2.0`.

Installed public reference root: `/Users/josh-desktop/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/`.

## Findings

### 1. Medium — cancellation during sandbox preparation still launches a command

**Confirmed by control flow; not reproduced with a delayed sandbox fixture.** `src/readonly-shell.ts:50-56` awaits sandbox initialization and wrapping before spawning. Only afterward does line 64 register an abort listener. There is no `signal.aborted` check between these awaits and spawn, or immediately after listener registration. AbortSignal does not replay a previously dispatched abort event to a new listener. An abort during either await therefore still launches the command; cancellation is only observed on eventual process close at line 74. Without a timeout, a long-running command can retain the tool indefinitely after cancellation.

This violates the cancellation contract of the replacement shell even though the command remains sandboxed. Check cancellation after preparation and before launching, and close the listener-registration race. Add a test that pauses initialization/wrapping, aborts, then releases it and asserts no command starts. Existing readonly tests cover permissions, unavailable platforms, and resume, not this timing boundary.

### 2. Low — unknown badge metadata can resolve inherited Object properties

**Reproduced.** `src/mode.ts:70-71,79-82` indexes ordinary object dictionaries with arbitrary metadata strings. `constructor`, `toString`, and `__proto__` are inherited keys, not unknown values falling back as intended. Running:

```sh
bun -e 'import {modeBadge} from "./extensions/pi-pstack/src/mode.ts"; const badge=modeBadge({skill:"x"},{"cursor-icon":"constructor","cursor-color":"constructor"}); console.error(JSON.stringify({text:badge.text,colorType:typeof badge.color}));'
```

produced:

```json
{"text":"function Object() { [native code] } mode: x","colorType":"function"}
```

The malformed color is subsequently supplied to `ctx.ui.theme.fg` at line 98, despite the claimed `ThemeColor` type. At minimum the visible icon is wrong; this review did not exercise the theme's invalid-token failure behavior. Use own-property lookup or a Map. This is a boundary bug for externally loaded skill metadata, not a failure of the bundled poteto-mode badge.

### 3. Low — readonly shell unit test leaks a temporary directory

**Confirmed.** `test/readonly-shell.test.ts:31-37` calls `mkdtempSync` and never removes the directory. Register test-scoped cleanup, including when the assertion fails. This is test resource cleanup, not evidence that production sandbox resources lack shutdown cleanup.

## Native-first architecture assessment

### Readonly bash override

The override itself uses supported Pi mechanisms:

- Public `dist/index.d.ts:20,26` exports `createBashTool`, `BashOperations`, and `createLocalBashOperations`.
- `dist/core/tools/bash.d.ts:35-51` defines the exact `exec(command, cwd, { onData, signal, timeout, env })` contract, including null exit and signal termination semantics; lines 65-72 document custom operations.
- Official `examples/extensions/tool-override.ts` expressly supports registering a same-name tool, including for sandboxing.
- Official `examples/extensions/ssh.ts` spreads a built-in tool and delegates to `createBashTool(..., { operations })`, matching the wrapper structure here.

No unsupported import or interception proxy was found. An OS restriction needs a sandbox; Pi tool exposure and annotations alone do not enforce filesystem/network restrictions. Lazy initialization and `session_shutdown` reset (`readonly-shell.ts:26-33,91-94`) respect the startup boundary and provide production cleanup.

**Unnecessary custom infrastructure:** lines 36-78 rebuild local process-group killing, stream forwarding, timeouts, abort handling, and exit-code conversion even though Pi 1.2.0 publicly exports `createLocalBashOperations`. Its declaration (`bash.d.ts:55-63`) specifically recommends it when wrapping/rewriting commands while retaining Pi's standard shell behavior. The smaller design is sandbox preparation/wrapping followed by native local operations. Verify cancellation and launch configuration when migrating; a native delegate cannot retroactively cancel the sandbox initialization await. No concrete native-gap justification for owning the local subprocess lifecycle appears in the new code. This duplication is directly related to finding 1, not a request for a general refactor.

### Task card renderResult

Supported API, not a signature defect. `dist/core/extensions/types.d.ts:518` accepts `AgentToolResult`, render options, theme, and context and returns a component. A callback may ignore trailing arguments. Returning Pi TUI `Text` (`src/task/card.ts:26-27`) is appropriate; narrowing the options consumed to `{ expanded: boolean }` is compatible. The official extensions documentation explicitly supports tool rendering for interactive transcripts and HTML exports. The card formatting helper is small and independently testable; it is not excessive abstraction.

A defensive concern, **not a demonstrated current Task-result defect**: `card.ts:11-12` checks only property presence, then assumes `model` is null or a valid object at line 22. Malformed imported/historical details could throw, but current Task's `details()` (`src/task/tool.ts:165`) supplies the expected shape. Do not report this as a proven normal-path regression.

The card says `Pi's default model` when no explicit model was selected; it does not report the actual provider/model chosen by the child's settings. Consequently README line 41's claim that the card names “the model that ran” is stronger than the implementation for that path. This is an observability/documentation limitation, not a Pi renderResult API failure.

### modeBadge

Uses native status and theme APIs, not a second renderer. Exported `ExtensionUIContext` declares `setStatus(key, text)` at `types.d.ts:84`, and `ThemeColor` is publicly exported (`dist/index.d.ts:37`). `ctx.hasUI` is appropriate because status forwarding is exercised in RPC; using `ctx.mode === "tui"` is not necessary for this supported UI primitive. Mapping Cursor icons/colors to semantic Pi theme tokens is a small justified adapter. Finding 2 concerns lookup correctness, not architectural ownership.

### AskQuestion schema and dialogs

Pi has no exported Cursor AskQuestion schema to adopt. A TypeBox custom-tool schema plus `ctx.ui.select` is the native integration. Pi declares `select(title: string, options: string[], opts?)` at `types.d.ts:74`; composing labels/descriptions into strings matches it. The tool is model-only and sequential (`src/ask.ts:82-83`), and unavailable noninteractive sessions are handled. Added title/description fields are covered by schema fixtures and real RPC dialog tests. Duplicate visible text is validated before mapping selections back to IDs. No confirmed new schema/API defect found. Fixture calls are evidence of observed compatibility, not proof of every possible Cursor schema variant.

## Packaging and portability

- `package.json:30-32` correctly places `@anthropic-ai/sandbox-runtime@0.0.79` in runtime dependencies, not peers. Pi host libraries remain peers. `bun.lock:75,116` includes the new package and transitive dependency metadata.
- Installed official `docs/packages.md`, “Declare dependencies,” says npm/git installs install dependencies, whereas local packages are not installed or modified. README lines 7-16 now explicitly instruct local users to install dependencies and explain fail-closed behavior when they are missing. This is not an undeclared dependency defect.
- Lazy import confines dependency absence to readonly shell execution. The fresh-copy package e2e test passes and verifies missing dependencies do not fall back to unrestricted execution.
- macOS/Linux are the supported sandbox paths; Windows and Linux hosts without required sandbox facilities fail closed. This is documented at README line 44, not portable shell availability. Ordinary package functionality can remain usable there.
- This review exercised macOS only. Linux sandbox startup and missing-bubblewrap behavior were not executed. Tests currently skip based on OS, not actual sandbox availability, so a Linux CI host without prerequisites may fail the positive permission test even though production fail-closed behavior is correct. Treat this as a portability/test-environment concern, not a proven runtime escape.
- No evidence of bundling host Pi dependencies, dependence on another Pi package's undeclared library, or unsandboxed fallback was found.

## Verification performed

All commands used existing package scripts/tooling; none changed implementation.

1. `bun run --filter pi-pstack typecheck` — passed.
2. `bun run --filter pi-pstack test -- test/ask.test.ts test/mode.test.ts test/task-card.test.ts test/readonly-shell.test.ts test/task-runner.test.ts` — 5 files, 55 tests passed.
3. `bunx biome check extensions/pi-pstack/src/readonly-shell.ts extensions/pi-pstack/src/task/card.ts extensions/pi-pstack/src/ask.ts extensions/pi-pstack/src/mode.ts` — passed, no fixes applied.
4. `bun run --filter pi-pstack test -- test/e2e/ask.e2e.test.ts test/e2e/mode.e2e.test.ts test/e2e/package.e2e.test.ts` — 3 files, 11 tests passed.
5. `bun run --filter pi-pstack test -- test/e2e/task.e2e.test.ts -t 'readonly|writable child'` — 4 passed, 33 filtered/skipped. Includes real sandboxed git/pipe reads, denied writes/network, writable-child behavior, and writable-to-readonly resume.
6. Direct modeBadge inherited-key probe — reproduces finding 2.

No full-suite coverage, Linux/Windows execution, interactive visual inspection, or cancellation race fixture was run. Passing current tests does not cover finding 1. No critical sandbox escape was confirmed.

## Verdict

The requested integration points are real Pi 1.2.0 public APIs, and current targeted runtime tests pass. Address the cancellation race before calling the readonly shell cancellation-safe. Prefer Pi's native local shell backend over the duplicated subprocess lifecycle. Fix inherited-key badge lookup and temporary test cleanup. Packaging dependency declaration and documented fail-closed portability are sound; broader Linux availability claims still need environment-specific verification.
