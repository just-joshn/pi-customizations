# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
## 5. Vitest

These rules cover the Vitest suites under `extensions/*/test`. They restate the official Vitest 5 guide (vitest.dev, `docs/guide` at tag `v5.0.5`) for this repository: Node-only Pi extensions and CLI scripts, `environment: 'node'`, `globals: false`, `pool: 'forks'`, `isolate: true`, V8 coverage. Browser mode and DOM environments do not apply here.

Run tests with each package's own scripts (`bun run test`, `bun run test:coverage`), or `bun run test` at the root for every workspace. Follow the existing conventions: `test` rather than `it`, explicit imports from `vitest`, `*.test.ts` files in each package's `test/` directory.

### What to test

- Test what callers can observe: return values, thrown errors, side effects, and output. Do not assert private helpers, intermediate variables, or which internal options were passed.
- Keep each test on one behavior. Name it after that behavior, such as "rejects an expired token", never "works correctly".
- Cover the main behavior, then boundaries, error paths, and the inputs the code realistically receives. Do not chase every possible input.
- Fix a bug by first writing a test that fails because of it, then changing the code. Never make a failing test pass by weakening the test.
- Do not depend on test order, generated IDs, shared module-level counters, or wall-clock timing.

### Structure

- Use Arrange, Act, Assert. Section comments are not needed.
- Keep `describe` nesting to one or two levels. Drop `describe` when it adds no context.
- Use `test.for` for parameterized cases, not Jest-style `test.each`. Use named case objects once a case has more than two or three values.
- Never commit `.only`. Use `.skip`, `.skipIf`, and `.todo` only when the reason is visible to the next reader.
- Use Vitest APIs (`vi.fn`, `vi.mock`), never Jest names (`jest.fn`, `jest.mock`).

### Isolation and setup

- Every test must pass alone and in any order. Create fresh mutable state per test.
- Prefer `test.extend` fixtures for reusable setup and teardown over `let` variables shared through hooks. Keep fixtures test-scoped unless sharing is intended.
- Use `beforeEach`/`afterEach` for per-test work and `beforeAll`/`afterAll` only for resources that are deliberately shared. Scope hooks to the smallest `describe`.
- Put cleanup next to the resource it releases with `onTestFinished`. Use `using` with `vi.spyOn`, `vi.fn`, or `vi.doMock` when a spy should be restored at the end of a block (Node 24+ or a TypeScript target that supports explicit resource management).
- Restore every process-wide change: environment variables (`vi.stubEnv` plus `vi.unstubAllEnvs`), globals (`vi.stubGlobal` plus `vi.unstubAllGlobals`), fake timers, temp directories, servers, child processes, and `process` listeners.
- Keep `isolate: true`. Turning isolation off is only safe for files that do not mutate module-level state, stub globals or env, patch prototypes, register long-lived listeners, or need a fresh module for `vi.mock`. Prove it by running with `--sequence.shuffle` more than once.

### Async work

- Write async tests with `async`/`await`. Always `await` `expect(...).resolves` and `expect(...).rejects`. Vitest fails a test that leaves an assertion unawaited.
- Await every promise the test starts. An unhandled rejection fails the run. Do not silence it.
- Add `expect.hasAssertions()` or `expect.assertions(n)` only where assertions sit inside callbacks, loops, or branches that might not run.
- Pass the test context `signal` to `fetch`, `spawn`, timers, and any helper that takes an `AbortSignal`, so a timed-out or cancelled test releases its work.
- Never wait with a fixed `setTimeout` sleep. Use `expect.poll` when the condition is an assertion, `vi.waitFor` when the work itself throws until ready, and `vi.waitUntil` when a lookup may be falsy and a throw should fail fast.
- When the code depends on time, use `vi.useFakeTimers()`, advance time explicitly, and call `vi.useRealTimers()` afterwards.
- Raise a timeout only for work that is genuinely slow, never to hide an unresolved promise.

### Assertions

- Pick the matcher that states the requirement: `toBe` for primitives and identity, `toEqual` for structure, `toStrictEqual` when `undefined` keys, classes, or sparse arrays matter, `toBeCloseTo` for floats.
- Use `toMatchObject`, `toHaveProperty`, and asymmetric matchers (`expect.any`, `expect.objectContaining`, `expect.stringMatching`) when only part of a value is the contract.
- Do not let a weak matcher (`toBeDefined`, `toBeTruthy`, `not.toThrow`, bare `toHaveBeenCalled`) be a test's only check when the real value is known.
- Wrap the call in a function for `toThrow`: `expect(() => parse(input)).toThrow(/expected/)`.
- Use `expect.soft` only for independent checks where seeing every failure helps.
- `mock.calls` holds references, not copies. Assert before the argument is mutated, or copy it first.

### Mocking

- Prefer real implementations when they are fast and deterministic: pure functions, in-memory structures, temp directories.
- Never mock the unit under test. Mock its boundaries: network, the Pi host, the clock, child processes.
- Use `vi.fn()` for new functions and `vi.spyOn()` to observe or replace an existing method. Use `mockResolvedValue` and `mockRejectedValue` for async results, and `vi.when()` when the result depends on the arguments.
- Write module mocks as `vi.mock(import('./module.js'), factory)` so TypeScript checks the path and types `importOriginal`. Remember `vi.mock` is hoisted above imports; values its factory needs must come from `vi.hoisted`.
- `clearMocks` defaults to `true` in Vitest 5, so call history resets before each test. Implementations are not reset and spies are not restored unless `restoreMocks` is enabled or the test restores them. Do not enable `restoreMocks`, `unstubEnvs`, or `unstubGlobals` globally for files that use `test.concurrent`; each one undoes state for tests still running.
- For HTTP, use the package's existing approach (a fake fetch or a local server). If a new suite needs network mocking, Vitest recommends Mock Service Worker over hand-written fetch stubs. For heavy file-system mocking, Vitest recommends `memfs`; a real temp directory is usually simpler here.

### Snapshots

- Snapshot only stable output where the whole shape matters. Use targeted assertions when a few fields matter.
- Prefer `toMatchInlineSnapshot` for small values and `toMatchSnapshot` or `toMatchFileSnapshot` for large ones.
- Replace IDs, timestamps, and absolute paths with property matchers or normalization before snapshotting.
- Read every snapshot diff before running with `-u`. Commit `.snap` files with the test.
- In `test.concurrent` tests, use the `expect` from the test context so snapshots attach to the right test.

### Parallelism and performance

- Tests inside a file run sequentially by default. Use `test.concurrent` only for independent tests that spend time waiting.
- Keep file parallelism on. Serialize only the files that share an exclusive resource, through a separate project with `fileParallelism: false`, not by turning it off for the whole package.
- Do not change `pool`, `isolate`, or worker counts because a suite feels slow. Measure first: read the transform, import, and tests timings Vitest prints, profile with `execArgv: ['--cpu-prof']`, or compare configurations with `vitest doctor`.

### Coverage and types

- Use the V8 provider and keep `coverage.include` pointed at `src/**/*.ts` so untested files appear in the report. Keep each package's existing thresholds; do not invent new ones.
- Vitest strips types without checking them. Run the package's `bun run typecheck` when types matter.
- When a type is the contract, test it with `expectTypeOf` or `assertType` in a `*.test-d.ts` file run with `vitest --typecheck`.

### Before you finish

- Run the narrowest test file first, then the package suite. Run the root `make verify` for changes that cross packages.
- Confirm no `.only` remains, every resource your tests open is closed, and every snapshot change was reviewed.
