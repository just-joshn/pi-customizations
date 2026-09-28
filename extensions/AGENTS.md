# Vitest 5 unit-test best practices for a CLI tool

Scope: **unit tests only** for a Node.js CLI. This intentionally excludes component, browser, integration, end-to-end, real-process, and system tests. It is based on the current official Vitest 5 documentation. Vitest 5.0 is the current supported major release. 

### Test design

- **Test the contract, not the implementation.** Assert observable inputs, return values, errors, and intended side effects. A refactor that preserves behavior should normally leave the test passing. 
- **Test one behavior per test.** If the test name naturally contains several unrelated "and"s, split the test. 
- **Name tests by behavior.** Prefer `returns an error for an unknown option` over `calls parseArgs correctly`. A failing test name should explain what behavior broke. 
- **Use Arrange, Act, Assert as the mental structure.** Setup, execute one behavior, then assert. Comments marking those sections are usually unnecessary.
- **Cover the normal path, boundaries, and realistic error paths.** Do not enumerate every possible input. Concentrate on boundaries and cases a real caller can trigger. 
- **For a bug, reproduce it with a failing test before fixing it.** Keep that test as the regression test. 
- **Make every test independent.** Create fresh state for each test and avoid assertions whose result depends on another test having run first. 
- **Do not depend on specific values of shared module state.** If a module has counters, caches, or other module-level mutable state, either assert behavior that does not depend on its current absolute value or isolate/reset the module appropriately. 
- **Keep `describe` nesting shallow.** A flat file is fine for simple modules. Use `describe` to group multiple exported functions or coherent behaviors, usually no more than one or two levels deep. 
- **Split oversized test files by behavior or feature area.** Vitest's guide suggests splitting files that grow beyond a few hundred lines. 
- **Use a consistent test-file layout.** Co-locating `foo.test.ts` with `foo.ts` is the simplest default, although a separate test directory is also supported.
- **Use the `node` environment for a normal CLI.** `node` is Vitest's default environment. Do not add `jsdom` or `happy-dom` to a CLI unit suite unless the code actually requires browser APIs. 

### Keep the CLI unit boundary small

- **Unit-test parsing, validation, command dispatch, formatting, configuration resolution, and pure command logic directly.**
- **Keep OS and external effects at the boundary.** For the unit-test layer, replace uncontrollable filesystem, environment, time, network, and similar dependencies rather than exercising the real resources. This follows Vitest's guidance to mock dependencies that are slow, nondeterministic, or have uncontrollable side effects. 
- **Do not mock the unit under test.** Mock its dependencies. Prefer real implementations when a dependency is a fast, deterministic pure function or in-memory data structure. 
- **Do not make spawning the installed CLI binary the core of this unit suite.** Testing the executable, shell, real child process, real filesystem, or complete command invocation crosses into a broader test boundary and is outside this checklist.
- **Separate CLI policy from process termination when possible.** Unit tests are easiest when command logic can produce a result or exit-code decision and the thin executable boundary performs the actual process operation.
- **For existing code that writes through an object such as `console`, use `vi.spyOn` when you need to observe or replace that method**, then restore the spy after the test. 

### Assertions

- **Use the most precise matcher for the contract.** `toBe` is appropriate for primitives and identity, `toEqual` for object structure, and `toStrictEqual` when prototypes, explicit `undefined`, or sparse-array distinctions matter. 
- **Prefer precise nullability assertions.** Use `toBeUndefined`, `toBeNull`, or `toBeDefined` when that is what you mean rather than a broad `toBeTruthy` or `toBeFalsy`. 
- **For partial structures, assert only the contract you care about.** Use `toMatchObject`, `toHaveProperty`, or asymmetric matchers such as `expect.any`, `expect.stringMatching`, and `expect.arrayContaining`. 
- **Wrap synchronous throwing calls.** Use `expect(() => parseArgs(...)).toThrow(...)`, not `expect(parseArgs(...)).toThrow(...)`. 
- **Always `await` asynchronous assertions.** In Vitest 5, unawaited `resolves`, `rejects`, and other async assertions fail the test rather than merely producing a warning.
- **Prefer straightforward `async`/`await` and direct assertions.** Use `expect.hasAssertions()` when assertions live in callbacks, loops, or conditional paths where they might never execute. Use `expect.assertions(n)` when the exact number matters. 
- **Consider `expect.requireAssertions` if every test in the project is expected to execute at least one Vitest `expect`.** Remember that Chai `assert` and `.should` do not count toward this setting. 
- **Use `expect.soft` only when several assertions are genuinely independent and seeing all failures in one run is useful.** Normal assertions are the clearer default. 

### Parameterized CLI cases

- **Use `test.each` for input/output matrices.** CLI parsers are a natural fit for tables of arguments, expected values, invalid inputs, option aliases, and boundary cases.
- **Use `test.for` when you need `TestContext` or want an array test case passed as one value instead of spread into arguments.** 
- **Keep each table row understandable from the generated test name.** Use Vitest's title placeholders when they make failures easier to identify. 

### Mock only real boundaries

- **Use `vi.fn()` for stand-alone fake dependencies and callbacks.**
- **Use `vi.spyOn()` when you need to observe or temporarily replace an existing object's method while retaining the ability to restore it.**
- **Use `vi.mock()` for module boundaries.** Do not create elaborate module mocks when a small injected function can express the same dependency more clearly. Vitest itself recommends mocks primarily for dependencies that are slow, flaky, nondeterministic, or side-effectful. 
- **Remember that `vi.mock()` is hoisted before imports.** Its apparent textual location inside a test or hook does not control when it executes.
- **Use `vi.hoisted()` when a hoisted `vi.mock()` factory needs shared mock objects or setup created before imports.** 
- **Use `vi.doMock()` when the mock must depend on test-local or file-scope values and must not be hoisted.** It affects only subsequent imports, so pair it with a dynamic `import()`. 
- **Prefer the typed module-promise form where useful:** `vi.mock(import('./dependency.js'), ...)`. Vitest can infer the original module type and validate the mock factory's exports. 
- **Use `importOriginal` or `vi.importActual()` for partial module mocks.** Preserve the real exports and replace only the boundary you need to control. 
- **Know the intra-module mocking limitation.** Mocking an exported function changes external access to that export. It does not rewrite another function in the same module that directly calls the original internal binding. Test the external behavior or create a real dependency boundary instead. 
- **Do not import a module in `setupFiles` if individual tests later need to mock that module.** It is already cached by the time the test file runs. 
- **Use `vi.resetModules()` only when module-local state really needs reevaluation.** Re-import dynamically after the reset. Top-level imports cannot be reevaluated, and `resetModules()` does not reset the mock registry. 
- **Use `vi.mocked()` for TypeScript typing of already-mocked values.** It does not mock anything at runtime. It provides the appropriate mock types. 
- **Use Vitest 5's `vi.when()` when mock behavior depends on arguments rather than call order.** It defines argument-specific behavior and supports asymmetric matchers. 

### Clean mock state correctly

- **Know that Vitest 5 sets `clearMocks: true` by default.** Call histories are cleared before every test, while mock implementations remain intact. This differs from Vitest 4. 
- **Use "clear" when you only want call history removed.** `mockClear()` and `vi.clearAllMocks()` preserve the implementation. 
- **Use "reset" when you also want mock implementations reset.** `mockReset()` and `vi.resetAllMocks()` clear history and reset implementation behavior. 
- **Use "restore" for spies when you want the original method back.** `mockRestore()` or `vi.restoreAllMocks()` restores methods replaced with `vi.spyOn`. 
- **Restore spies between tests.** Vitest's mock guide explicitly warns against allowing mock state to leak between tests. `restoreMocks: true` is available if automatic restoration fits your suite. 
- **Do not confuse `clearMocks` with `restoreMocks`.** Vitest 5 clears mock history automatically, but it does not therefore restore every spied implementation. 

### Environment variables and globals

- **Use `vi.stubEnv()` for `process.env` or `import.meta.env` changes.** It updates both and gives Vitest a way to restore the original value. 
- **Restore stubbed environment variables with `vi.unstubAllEnvs()` or enable `unstubEnvs`.** Environment changes otherwise persist between tests. 
- **Use `vi.stubGlobal()` instead of permanently assigning test globals when you need restorable global state.** Restore with `vi.unstubAllGlobals()` or `unstubGlobals`. 
- **Treat environment and global mutation as shared state.** Keep such tests sequential unless you have deliberately isolated that state.

### Filesystem behavior

- **Do not make unit tests depend on the real filesystem.** Vitest's current filesystem guide explicitly recommends mocking it for predictable, side-effect-free tests.
- **Use `memfs` for filesystem-heavy unit tests.** Vitest specifically recommends it rather than maintaining large manual `node:fs` mocks. 
- **Mock both `node:fs` and `node:fs/promises` when production code can use both APIs.** 
- **Reset the in-memory filesystem before each test with `vol.reset()`.** Do not let files from one case leak into the next. 
- **Use the fake filesystem to exercise hard error paths.** The official guide specifically calls out conditions such as read/write failures and other cases that are difficult to reproduce safely on the real disk.

### Time and timers

- **Use fake timers instead of making the suite actually wait.** `vi.useFakeTimers()` controls timeouts and intervals deterministically. 
- **Restore real timers after the test with `vi.useRealTimers()`.** 
- **Use `vi.setSystemTime()` for code whose behavior depends on the current time.** Vitest 5 controls both `Date` and `Temporal`.
- **Remember that fake timers also alter the perceived system date.** Do not combine time mocks casually without understanding that interaction.
- **Do not assume `process.nextTick` or `queueMicrotask` are faked by default.** They require explicit `toFake` configuration. Also note Vitest's warning that mocking `nextTick` is unsupported with the `forks` pool because Node child-process internals use it. 

### Setup, cleanup, and fixtures

- **Prefer fresh inline setup when it is small.** It keeps each test self-contained and independent. Vitest's guide explicitly demonstrates creating a fresh object in every test.
- **Move repeated per-test setup to `beforeEach` when repetition stops helping readability.** `beforeEach` gives every test a known starting state. 
- **Use `afterEach` for shared cleanup.** It runs even when the test fails. 
- **Use `onTestFinished` when cleanup belongs beside the resource creation inside one test.** This keeps resource ownership and cleanup together.
- **A `beforeEach` hook can return its cleanup function.** Use this when setup and teardown naturally form one operation. 
- **Use `test.extend` fixtures for reusable test dependencies.** Vitest describes fixtures as a better pattern than scattered `let` variables plus hooks for many setup/teardown cases. Fixtures initialize only when the test requests them and can clean themselves up. 
- **Use `beforeAll` only for setup that is expensive and safe to share for the whole suite.** Do not use it to create mutable test state that makes tests order-dependent. 
- **Use `setupFiles` for genuine project-wide setup such as custom matchers, polyfills, or global configuration.** Do not turn it into a dumping ground for per-test state.

### Snapshot testing CLI output

- **CLI output is an explicitly documented snapshot use case.** Snapshots work well for formatted output or error messages where you care about the complete representation.
- **Use targeted assertions instead when only one or two details matter.** A snapshot that captures irrelevant fields makes the contract less clear.
- **Prefer inline snapshots for small CLI strings and compact structured values.** The expected value stays beside the test. 
- **Use external or file snapshots for large formatted output.** `toMatchFileSnapshot()` is useful when preserving the raw file format improves reviewability. 
- **Use snapshot property matchers for dynamic values** such as generated IDs or timestamps instead of making the whole snapshot unstable. 
- **Commit external snapshot artifacts.** Review them as test assertions during code review. 
- **Never blindly update snapshots.** Review the diff and confirm the new output is intentional before accepting it.
- **Use error inline snapshots when the exact CLI error text is part of the contract.** Vitest provides `toThrowErrorMatchingInlineSnapshot`.

### Concurrency

- **Keep tests independent before considering `test.concurrent`.** Independence is a testing requirement, not something concurrency should compensate for. 
- **Do not run tests concurrently when they mutate shared process state** such as globals, environment variables, timers, module state, or shared spies.
- **Be particularly careful with `restoreMocks`, `unstubGlobals`, and similar automatic cleanup in concurrent tests.** Vitest warns that one concurrent test can restore state still being used by another. 
- **Use the local `expect` from `TestContext` in concurrent tests when using snapshots or assertion counting.** This lets Vitest associate assertions with the correct test. 
- **Do not add concurrency to synchronous tests expecting automatic speedups.** Vitest notes that synchronous concurrent tests still execute sequentially.

### Isolation

- **Keep Vitest's default file isolation unless you have a reason to change it.** `isolate` defaults to `true`.
- **For a proven-pure unit-test project with no shared mutable module state, `isolate: false` can reduce overhead.** Vitest has a dedicated recipe for this optimization. Do not apply it to tests that rely on module, environment, global, or other shared state isolation.

### Focused, skipped, and unfinished tests

- **Use `.only` for local debugging, not committed test selection.** Remove it before committing. Vitest rejects `.only` in CI by default when `CI` is set. 
- **Use a `no-focused-tests` lint rule if you want to catch `.only` before CI.** The Vitest guide explicitly points to the ESLint and oxlint rule. 
- **Use `.todo` for a known test that has not been implemented yet.** It remains visible in test reporting. 
- **Use `.skip` sparingly for temporary cases.** Do not silently turn known regressions into permanently skipped coverage.
- **Use `test.fails` when intentionally tracking a known currently-failing behavior.** Vitest 5 reports these expected failures in the summary. 

### Flakiness and debugging

- **Re-run suspected flaky tests rather than trusting one successful run.** Vitest 5 added `--repeats` specifically for repeating every test to hunt flakiness. 
- **Use test names and Vitest's assertion diffs before adding debugging noise.** Vitest reports the failing test, source line, expected value, received value, and diff. 
- **Use `--detectAsyncLeaks` when investigating leaked asynchronous resources in Node tests.** 

### Coverage

- **Treat coverage thresholds as an enforceable suite constraint when coverage matters to the project.** Vitest supports thresholds for statements, branches, functions, and lines.
- **A positive threshold means a minimum percentage.** For example, `90` means at least 90% coverage. 
- **A negative threshold means a maximum number of uncovered items.** For example, `lines: -10` permits at most ten uncovered lines. 
- **Use `coverage.thresholds.perFile` when every unit should independently meet the configured threshold instead of letting highly covered files hide poorly covered ones.** 

### Sensible Vitest 5 defaults for this kind of suite

For a sequential Node CLI unit suite that uses spies, environment stubs, and global stubs, this is a reasonable cleanup-oriented configuration derived directly from the APIs above:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',

		// Vitest 5 already defaults clearMocks to true.
		restoreMocks: true,
		unstubEnvs: true,
		unstubGlobals: true,

		expect: {
			requireAssertions: true,
		},
	},
})
```

`clearMocks: true` is already the Vitest 5 default, so explicitly repeating it is optional. `restoreMocks`, `unstubEnvs`, and `unstubGlobals` solve different cleanup problems and are not replacements for one another. If you adopt `test.concurrent`, reconsider automatic restoration because Vitest documents shared-state hazards with concurrent tests.

The core rule for a CLI unit suite is: **run the CLI's decision-making code for real; fake only the boundaries that would make the test nondeterministic, slow, or externally side-effectful; and assert the observable contract rather than how the implementation reached it.** That matches Vitest's current testing-in-practice guidance particularly closely.

# Vitest integration-testing best practices for a CLI

Grounded in the current official Vitest v5.0.2 documentation. This excludes unit-testing, component-testing, and browser-testing guidance unless it directly affects a Node CLI integration suite.

1. **Test the CLI's observable contract.** Vitest recommends testing inputs, outputs, side effects, and errors rather than implementation details. For a CLI, map that to arguments, configuration, environment, stdin, and working directory as inputs, then exit behavior, stdout, stderr, filesystem changes, and other externally visible effects as results. A refactor that preserves those behaviors should not break the test.  
   https://vitest.dev/guide/learn/testing-in-practice

2. **Do not mock the CLI under test.** Vitest explicitly says not to mock the thing being tested and to prefer real implementations when they are fast and reliable. In an integration suite, exercise the real CLI behavior and mock only dependencies that are slow, flaky, or have side effects you cannot control.  
   https://vitest.dev/guide/learn/testing-in-practice

3. **Keep each test focused on one behavior.** Use descriptive names that state the CLI behavior rather than its implementation. Cover the normal path, realistic boundaries, invalid inputs, and error paths that a real caller can trigger.  
   https://vitest.dev/guide/learn/testing-in-practice

4. **Give integration tests their own Vitest project.** Use a named project such as `integration` with an explicit pattern such as `**/*.integration.test.ts`, then run it independently with `vitest --project integration`. Vitest's own examples use separate projects for integration tests. In Vitest 5, inline projects inherit the root configuration by default, so use `extends: false` only when the integration project deliberately needs an independent configuration.  
   https://vitest.dev/guide/projects

5. **Use the Node environment for a Node CLI.** `node` is Vitest's default environment. Do not introduce `jsdom`, `happy-dom`, or Browser Mode for a normal CLI integration suite.  
   https://vitest.dev/config/environment

6. **Prefer the `forks` pool when tests use process-level Node APIs.** `forks` is the current default. Vitest documents that `process.chdir()` is available under `forks` but unavailable under `threads`, which matters for CLI tests that exercise working-directory behavior.  
   https://vitest.dev/config/pool

7. **Keep test-file isolation enabled for integration tests.** Vitest defaults `isolate` to `true`, and its integration-specific recipe explicitly keeps integration tests isolated while showing isolation removal only as an optimization for suitable unit tests. Isolation protects against leaked module state, environment changes, process listeners, mocks, and similar cross-file state.  
   https://vitest.dev/config/isolate

8. **Let independent files run in parallel.** Vitest runs test files in parallel by default and gives each file an isolated environment. Tests inside one file run sequentially by default, which Vitest describes as the safer default when setup or state is shared. Add `test.concurrent` or `describe.concurrent` only when those tests are genuinely independent.  
   https://vitest.dev/guide/parallelism

9. **Serialize only tests that share an exclusive resource.** Vitest specifically calls out fixed ports, writable temp directories, and databases without per-test isolation as reasons to put affected files in a separate project with `fileParallelism: false`. Do not disable parallelism for the whole integration suite because a few tests require serialization.  
   https://vitest.dev/guide/recipes/parallel-sequential

10. **Use `sequence.groupOrder` when project-level ordering really matters.** Separate projects normally overlap. If a sequential group must not run while another project still holds the same resource, give the projects different `sequence.groupOrder` values.  
    https://vitest.dev/guide/recipes/parallel-sequential

11. **Use per-test lifecycle cleanup for per-test resources.** `beforeEach` and `afterEach` are the normal choice when every test needs a known state, and `afterEach` still runs when a test fails. When a resource is created inside the test, Vitest recommends `onTestFinished` so setup and cleanup stay together. A `beforeEach` hook may also return its cleanup function.  
    https://vitest.dev/guide/learn/setup-teardown

12. **Use `setupFiles` only for setup that belongs to every test file.** They execute before each test file in the same test process and suit global configuration, polyfills, or custom matchers. They are not a substitute for a once-per-run external-service setup.  
    https://vitest.dev/config/setupfiles

13. **Use `globalSetup` for true once-per-run resources.** It runs before workers are created and supports teardown after the suite. Because it runs in a different global scope from the tests, pass serializable information such as a dynamically allocated port with `project.provide()` and read it with `inject()`. If that resource must be reset on watch reruns, use `onTestsRerun`.  
    https://vitest.dev/config/globalsetup

14. **Make spawned CLI processes cancellable.** Vitest's current recipe specifically lists `child_process.spawn` as a resource that should receive the test context's `signal`. The signal aborts when the test times out, the run is cancelled, `--bail` cancels it, or the user presses Ctrl+C. This prevents orphaned subprocesses and workers that refuse to exit.  
    https://vitest.dev/guide/recipes/cancellable

15. **Wait for conditions instead of sleeping for arbitrary durations.** Use `expect.poll` when readiness is an assertion, `vi.waitFor` when an operation may fail until a resource becomes ready, and `vi.waitUntil` when you are waiting for a truthy result and thrown errors should fail immediately. Vitest explicitly identifies fixed `setTimeout` waits as either flaky when too short or wasteful when too long.  
    https://vitest.dev/guide/recipes/wait-for

16. **Give slow integration operations explicit timeouts.** Node tests default to a 5-second `testTimeout`; Vitest also exposes separate hook and teardown timeouts. Increase the timeout for operations that legitimately take longer rather than allowing an operation to hang without a bound.  
    https://vitest.dev/guide/learn/async

17. **Await every asynchronous operation and asynchronous assertion.** Vitest treats unhandled promise rejections as test-run errors. In Vitest 5, asynchronous assertions such as `.resolves`, `.rejects`, and `toMatchFileSnapshot()` must be awaited.  
    https://vitest.dev/guide/learn/async

18. **Use snapshots for stable CLI output, not as an automatic approval mechanism.** `toMatchInlineSnapshot()` is suited to small output that benefits from living beside the test. Use `toMatchFileSnapshot()` for large or file-oriented output. Commit snapshot artifacts, review their diffs like normal assertions, and do not blindly update them. CI does not update snapshots by default; missing, obsolete, or mismatched snapshots fail the run.  
    https://vitest.dev/guide/snapshot.html

19. **Keep file snapshots outside Vitest's managed snapshot paths.** Do not point `toMatchFileSnapshot()` into paths such as `__snapshots__/foo.test.ts.snap`; Vitest requires a separate path pattern for file snapshots. Always `await` `toMatchFileSnapshot()`.  
    https://vitest.dev/guide/snapshot.html

20. **Use the test-context `expect` when snapshots run concurrently.** Vitest warns that async concurrent snapshot tests must use the local `expect` supplied by the test context so the snapshot is associated with the correct test.  
    https://vitest.dev/guide/snapshot.html

21. **Shuffle the suite periodically to expose hidden ordering dependencies.** Vitest specifically recommends repeated shuffled runs when verifying that tests do not depend on state leaked by earlier files. `sequence.shuffle` and `sequence.seed` let you reproduce an ordering when a shuffled run fails.  
    https://vitest.dev/guide/recipes/disable-isolation

22. **Keep retries targeted.** Vitest defaults retries to `0`. When an integration test genuinely talks to something transient, Vitest 5 supports `{ count, delay, condition }`, including conditions such as connection or timeout errors, so retries can be restricted to the failure modes that warrant them instead of rerunning every failure.  
    https://vitest.dev/config/retry

23. **Collect subprocess coverage explicitly when the CLI runs in another Node process.** With the V8 coverage provider, Vitest 5's `coverage.autoAttachSubprocess: true` collects coverage from spawned `node:child_process` and `node:worker_threads` processes. It is off by default and adds filesystem and runtime overhead, so enable it when subprocess coverage is required rather than unconditionally.  
    https://vitest.dev/config/coverage

24. **Remember that coverage is root-level across projects.** Vitest does not support project-specific `coverage` configuration because coverage belongs to the whole Vitest process. Reporters are also root-level rather than individual project options.  
    https://vitest.dev/guide/projects

25. **Use `hanging-process` only to diagnose process leaks.** The reporter lists processes preventing Vitest from exiting safely, which is especially useful for CLI suites that spawn child processes. Vitest warns that it is resource-intensive and recommends reserving it for debugging suites that consistently fail to exit.  
    https://vitest.dev/guide/reporters

26. **Do not hide asynchronous failures.** Vitest intentionally reports unhandled promise rejections as errors. Fix missing `await`s or explicitly handle expected rejection paths rather than disabling the protection.  
    https://vitest.dev/guide/learn/async

27. **Keep CI strict about focused tests.** Vitest's `allowOnly` defaults to `false` in CI, so a committed `test.only` or `describe.only` fails the run. Preserve that behavior rather than enabling `allowOnly` in CI.  
    https://vitest.dev/config/allowonly

28. **Keep "no tests found" as a failure unless it is intentional.** `passWithNoTests` defaults to `false`. For a dedicated integration project, that default catches broken include patterns or an accidentally empty CLI test suite.  
    https://vitest.dev/config/passwithnotests

29. **Use run mode for deterministic CI execution.** `vitest` automatically switches to run mode in CI or a non-interactive terminal; `vitest run --project integration` makes that intent explicit when invoking only the CLI integration project. Use `bail` only when stopping after a configured number of failures is useful for CI turnaround.  
    https://vitest.dev/guide/cli.html

30. **Treat integration-test speed problems as a scheduling problem before removing isolation.** Vitest's documented path is to keep independent files parallel, isolate integration tests, serialize only the files that share exclusive resources, and tune `maxWorkers` when resource usage is too high. Removing integration isolation trades correctness guarantees for speed and should not be the first optimization.  
    https://vitest.dev/guide/parallelism
