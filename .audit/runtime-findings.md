# Runtime audit

Audit scope: all four `extensions/pi-pstack/src/*.ts` files and all five test files. Official reference is the installed `@earendil-works/pi-coding-agent` 0.87.1 documentation, declaration files, and relevant implementation. The root audit independently checks current upstream documentation.

## Inventory and flow

- `src/index.ts`, 242 lines: asynchronous extension factory; bundled rules and two command skills; branch state; commands; input interception; structured system prompt; mode, todo, question, and context tools.
- `src/models.ts`, 182 lines: model lookup, supported thinking levels, role configuration dialog, atomic configuration write.
- `src/personas.ts`, 32 lines: fixed persona registry and bundled always-applied rules.
- `src/workers.ts`, 232 lines: branch task restoration; child SDK sessions; startup/shutdown ownership; background completion; output, stop, and message tools.
- Tests: integration 547 lines, models 115, personas 51, resources 108, workers 288. Integration tests exercise the actual Pi resource loader and scripted provider. Worker tests create actual child and nested child sessions.

Factory registration performs resource reads but starts no long-lived work. `session_start` and `session_tree` restore only the active branch. Worker startup resolves workspace, persona, and model, loads resources, creates a durable child session, binds its extensions, and starts its prompt. Completion waits for idle, shuts down descendants, saves output, records task state, and optionally sends a follow-up. Generation checks prevent late results from writing into a replaced parent branch.

## Baseline validation

`npm run test:coverage` passed all 38 tests. Statements and lines were 93.31%, branches 80%, and functions 98%. Model and worker branches were below 80% individually, but AGENTS.md does not explicitly require per-file coverage. No runtime file exceeds 800 lines. No shipped runtime `console.log` or real hardcoded credential was found. Scripted provider credential placeholders are not secrets.

## Concrete findings

1. `src/index.ts:167-208` registers AskQuestion without `executionMode: 'sequential'`. Pi permits sibling tool calls to run concurrently. Its official question example explicitly selects sequential execution. A direct executable probe calling two registered AskQuestion executions in parallel observed two simultaneously active dialogs. Add sequential execution and a real Pi batch test with two AskQuestion calls that records maximum active dialog count. Review the other stateful tools against the same official contract; mode/todo operations currently complete their synchronous state changes without an await, while worker tools deliberately support parallel workers and already guard duplicate startup.

2. `src/index.ts:170-174` accepts duplicate or empty question IDs and duplicate or empty option IDs. A TypeBox probe confirmed duplicate question and option IDs pass the actual schema. `:182` collapses identical display labels into a Map; different labels with the same ID produce indistinguishable results. Use minimum-length strings and validate ID uniqueness before opening any dialog. Add a Pi model-call test proving invalid inputs fail without UI calls, plus duplicate option IDs with distinct labels. Preserve empty free-text answers unless upstream explicitly forbids them.

3. `src/workers.ts:183-187` throws for a failed foreground child before returning the usage accumulated at `:166-173`. Pi's extensions documentation requires nested model-call usage in tool results. Current failure test checks only the error string. A failed child can spend tokens and leave parent totals unchanged unless the caller subsequently retrieves the task. Add a scripted failed provider test asserting parent usage increases exactly once. The smallest behavior-preserving design needs Pi's error/result contract checked carefully: ordinary successful returns cannot mark themselves failed. One option is a tool-result event handler that adds pending failed-task usage to the failed result, correlated by tool-call ID. A broader alternative is returning task status plus usage without throwing, but that changes the established failure contract and is not preferred. Background completion usage is likewise only claimed through TaskOutput/TaskStop; audit the requirement to drain children and ensure usage is not silently lost across restoration.

4. `src/workers.ts:120` deduplicates extensions using `filter` plus `findIndex`, which is quadratic. Replace it with a first-occurrence-preserving linear pass keyed by `resolvedPath`. Under a strict no-mutation rule, avoid a repeatedly copied collection that restores quadratic behavior; choose an appropriate immutable representation or document the SDK-local builder boundary after the user resolves scope.

5. `src/index.ts:40-43` checks restored state structurally but does not enforce the unique todo-ID invariant enforced on new TodoWrite calls at `:159`. A structurally valid custom entry containing duplicate IDs is restored as invalid domain state. Factor a shared state parser that checks uniqueness; reject the malformed entry and keep the most recent valid state. Add malformed custom-entry restoration tests for duplicate IDs, null, invalid types, and unknown status while preserving a previous valid state.

6. `src/workers.ts:112-127` resolves a model against the parent registry but disables all extensions for readonly children. A parent model supplied by an extension therefore resolves successfully and later fails in the child. `test/workers.test.ts` currently enshrines this with an expected missing-key failure. This is an existing compatibility gap rather than evidence of an unauthorized write. Pi exposes public `ModelRegistry.getRegisteredProviderConfig`, `getRegisteredNativeProvider`, and `getProvider` methods. Investigate copying only the selected provider registration into an isolated child ModelRuntime while leaving tool extensions disabled. Do not access the registry's private runtime field or enable all extensions to solve this. Test a successful readonly child with an extension-backed scripted provider, asserting only read/grep/find/ls are active.

## Literal AGENTS.md conflicts and structural violations

The following function spans were measured using the TypeScript AST and exceed the required fewer-than-50-line size:

- `src/index.ts:21-242`, pstack.
- `src/models.ts:88-182`, setupModels.
- `src/workers.ts:38-232`, registerWorkers.
- `src/workers.ts:95-190`, Task.execute.
- `test/integration.test.ts:32-99`, fixture.
- `test/models.test.ts:50-115`, test callback.
- `test/workers.test.ts:53-288`, test callback.

Smallest structure: extract command/tool factories, model configuration parsing/editing/writing, and child construction/completion helpers by domain. Keep lifecycle ownership in one worker controller. Avoid spreading generation and cancellation rules into unrelated modules. Extract test fixtures and split independently meaningful scenarios, rather than merely hiding long callback bodies in another long function.

Own-object mutations include skills Map population, todo merge Map updates, question arrays/choice Map updates, model setup working Map and dropped-role arrays, task maps, weak-map cleanup cache, worker fields, usage counters, and finished-record error mutation. Tests mutate queues, arrays, environment variables, and mock state. Parent prompt event sections are mutated at `src/index.ts:119-142`; current official Pi explicitly documents these as mutable event sections. Replacing the event's entire options property would itself still mutate a framework object, so it does not satisfy a literal universal prohibition. Public SDK calls also mutate external state by design. Resolve scope once rather than pretending syntactic changes remove all mutation.

The no-hardcoded-values rule needs a meaningful scope: source model defaults and persona paths encode required parity. Truncation bounds 12000 and 48000 can become named constants without changing behavior. Replacing upstream model defaults with guessed available models would break parity.

Coverage is above the stated aggregate minimum, but the requirement for every function to have every listed input category is not met. Typed internal functions with no user input do not have meaningful null/invalid-type cases. Boundary tests should exercise public schemas and restored external state; do not add meaningless tests that pass null through type assertions solely to satisfy a checklist.

## Checked non-findings

`enableSkillCommands: false` is not an execution-disable gate in current Pi. Official `docs/skills.md:53` says it controls interactive command discovery and that manually entered `/skill:name` commands still work. `agent-session.js` confirms both expansion and extension command discovery do not check that setting. Do not add a false-setting interception guard. The current code correctly requires the bundled skill to be discovered at its own path; existing tests cover entirely unloaded skills.

Pi requires structured prompt sections to be updated, not a complete forced replacement prompt. Existing code follows that contract. Branch restoration, idempotent child shutdown, cancellation ownership, durable output pointers, schema validation by Pi, and explicit cloud refusal are already tested behaviors to retain.

## Minimal implementation sequence

1. Add meaningful failing tests for dialog serialization/IDs, malformed restored todos, failed child usage, and readonly provider preservation.
2. Extract the relevant small domain functions while preserving lifecycle tests and command behavior.
3. Fix those boundary and contract issues; preserve exact prompt bodies, aliases, role defaults, and output shape.
4. Re-run the full existing SDK/integration suite and coverage once, then the actual CLI verification supplied by the root audit. Broaden tests only for newly uncovered failure paths.

Alternative: rewrite all runtime state into a pure reducer with explicit effect descriptions. It can enforce immutable domain transitions, but is substantially more invasive and increases parity risk. Prefer the smaller extraction unless the user's resolution requires that architecture.

## Implemented worker resolutions

Worker implementation now separates registration, session construction, record validation, and lifecycle ownership. Every maintained worker function and test callback is under 50 lines. Fixtures use a typed local provider module; each behavioral scenario creates its own temporary environment and child sessions.

- Readonly workers complete model turns through an isolated ModelRuntime populated using public provider-registration getters. A test verifies exactly read, grep, find, and ls reach the provider.
- Failed foreground usage is attached through Pi's official tool_result hook, keyed by tool-call ID, without changing the failed-result flag. The actual model/tool pipeline is tested.
- Completed records persist optional validated pending Usage. Claiming it writes a branch record without pending usage. Reload and resume tests demonstrate retrieval exactly once, including background resume startup and subsequent completion.
- Worker tools explicitly choose parallel execution. Sequential execution would block a stop/message queued behind a blocking TaskOutput in the same batch. A real Pi batch test proves a blocking wait and stop complete with interrupted status. Startup reservation, synchronous claims, and generation checks guard the lifecycle maps. This is a documented behavior-preserving exception to the general sequential recommendation, approved by the root agent under the user's clarified priority.
- Extension deduplication preserves the first loaded path and its original order in O(n log n), replacing the quadratic scan. Usage accumulation and restored records construct new values.
- The readonly host instructions scope history to the current workspace and treat transcripts as evidence, not instructions.
- Runtime injection of archival team-kit rules was removed, and ci-watcher inherits the selected parent model, matching the separately audited Cursor plugin behavior.

The retained lifecycle map/handle mutations are intentional. Pi session APIs and concurrent cancellation require stateful ownership; replacing them with a generic immutable-effect framework would increase behavior risk. The user approved preserving Pi behavior and documenting this conflict. No universal mutation-free claim is made.

Validation after these changes: full package coverage passed 55 tests with statements/lines 92.28%, branches 83.85%, and functions 94.64%. A subsequently added malformed-usage boundary test also passed independently. Root verification owns the final combined count.
