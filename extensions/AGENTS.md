Vitest unit tests

- Write unit tests only unless explicitly asked for another test level.
- Test observable behavior, not implementation details.
- Keep the subject under test small and deterministic.
- Run real deterministic project code. Mock external or nondeterministic boundaries.
- Do not over-mock.
- Never use Jest APIs. Use Vitest's test, expect, and vi APIs.
- Use short behavior-based test names.
- Keep describe nesting shallow.
- Cover the happy path, boundaries, empty values, invalid values, and dependency failures that the unit handles.
- Make every assertion prove the behavior named by the test.
- Prefer precise matchers over truthy/falsy assertions.
- Always await asynchronous expectations.
- Wrap synchronous throwing calls before toThrow.
- Use test.each/test.for for genuine behavior matrices.
- Use vi.fn for supplied callbacks and vi.spyOn for existing methods.
- Prefer vi.mock(import('./module.js')) when module mocking is necessary.
- Keep hoisted vi.mock/vi.unmock/vi.hoisted calls at top level.
- Do not mock same-module private helpers. Refactor the boundary if isolation requires it.
- Do not leak mocks, globals, env vars, timers, module state, or filesystem state between tests.
- Use vi.stubEnv and vi.stubGlobal instead of unmanaged mutation.
- Use fake timers instead of real waits.
- Use memfs or a mocked filesystem instead of developer-machine filesystem state.
- Keep tests sequential unless concurrent tests are demonstrably independent.
- Keep file isolation enabled unless measured evidence justifies disabling it.
- Use snapshots only when the complete serialized value is the contract.
- Review snapshot changes. Never update snapshots blindly.
- Configure coverage.include so completely untested source files are visible.
- Treat coverage as a signal, not a substitute for meaningful assertions.
- Run tests with `vitest run`, never interactive watch mode, from a coding agent.
- Run the affected test immediately after changing it.
- Run the relevant suite before declaring the task complete.
- Run TypeScript checking separately because normal Vitest execution does not type-check.

## Integration testing

These rules apply to integration tests for Pi extensions. They do not apply to unit tests or component tests.

### Test through real boundaries

- Test extension behavior through the real Pi runtime boundary whenever practical.
- Prefer loading the real extension and exercising its registered tools, commands, events, session behavior, or lifecycle over importing internal helpers directly.
- Use Pi's SDK for normal in-process integration tests.
- Use a real Pi subprocess only when the behavior under test depends on the CLI, process lifecycle, stdio, JSON mode, RPC mode, exit status, or process-level environment.
- Do not call a test an integration test if it only invokes an isolated helper or mocked implementation.

### Keep internal code real

- Do not mock the extension code under test.
- Do not mock internal modules merely to make setup easier.
- Mock or fake only boundaries that are slow, nondeterministic, costly, unsafe, or outside the test's control.
- Prefer a real temporary filesystem over mocking `node:fs`.
- Prefer a controlled HTTP boundary over mocking application client methods.
- For HTTP, WebSocket, or GraphQL dependencies, intercept the network boundary with MSW or an equivalent controlled local boundary.
- Fail tests on unexpected external network requests.
- Do not use live paid LLM APIs in the normal integration suite.

### Isolate every test

- Give every test its own temporary working directory.
- Pass the test working directory to Pi explicitly. Never rely on the repository's current working directory as implicit test state.
- Use in-memory Pi session storage unless persistence to disk is the behavior under test.
- Give external resources unique ports, paths, IDs, databases, and namespaces.
- Never write integration-test state into the developer's real `.pi` directory, home directory, session directory, or repository configuration.
- A test must not depend on another test having run first.
- A test must leave no persistent state that changes a later test.

### Preserve Vitest isolation

- Keep Vitest isolation enabled for integration tests.
- Keep test files parallelizable unless the resource under test genuinely cannot be isolated.
- Do not disable file parallelism to hide shared-state bugs.
- Keep tests within a file sequential by default.
- Use `test.concurrent` only when every resource used by those tests is independently isolated.
- Do not combine concurrent tests with process-global mutation unless the mutation is itself isolated.

### Own resource cleanup

- Clean up every resource created by a test: temporary directories, servers, sockets, subprocesses, watchers, timers, listeners, sessions, and environment changes.
- Register cleanup immediately after acquiring the resource.
- Prefer typed `test.extend()` fixtures for reusable integration resources.
- Keep one independently owned resource per fixture when practical.
- Cleanup must run even when the test assertion fails.
- Resource-owning extensions must have integration coverage proving that shutdown cleanup is idempotent.
- A completed integration test suite must not leave the Vitest process hanging.

### Test Pi lifecycle behavior

When the extension uses the corresponding feature, integration tests must cover:

- extension loading and registration
- `session_start`
- relevant agent and tool events
- session state reconstruction
- session replacement
- reload behavior
- cancellation or abort behavior
- `session_shutdown`
- cleanup after failure

Do not start long-lived sockets, subprocesses, watchers, or timers merely by loading an extension. If an extension owns long-lived resources, test that loading alone does not start them and that the appropriate session lifecycle starts and stops them.

After Pi reloads or replaces a session, do not reuse objects or contexts from the old runtime. Add an integration regression test for any bug involving stale runtime or session state.

### Test observable contracts

- Assert behavior visible through the extension's public contract.
- Prefer assertions on tool results, command results, emitted events, persisted state, filesystem changes, protocol messages, exit status, or cleanup.
- Do not assert private helper calls, internal implementation order, or incidental module structure unless that structure is itself the contract.
- A refactor that preserves externally visible behavior should normally not require integration-test changes.
- Give each test one primary behavior.
- Name tests after that behavior, for example `restores branch state when a session starts`.
- Cover realistic error paths and boundary conditions, not arbitrary permutations.

### Test asynchronous behavior deterministically

- Await all asynchronous work started by the behavior under test.
- Never use an arbitrary `sleep()` to wait for readiness.
- Use `expect.poll`, `vi.waitFor`, `vi.waitUntil`, an event, or another observable readiness condition.
- Await `resolves` and `rejects` assertions.
- Use `expect.assertions()` when an asynchronous callback or event could otherwise fail to execute without failing the test.
- Keep finite test and hook timeouts.
- Increase a timeout only when the legitimate operation requires it.
- Do not set global timeouts to `0`.

### Do not hide flaky tests

- Keep deterministic integration tests at zero retries.
- Do not add retries to hide races, leaked state, incomplete cleanup, arbitrary sleeps, or nondeterministic assertions.
- Fix the cause of a flaky integration test before increasing retries.
- If a genuinely transient external dependency requires retries, scope the retry to that test and document why.

### Control process-global state

- Restore spies and replaced implementations after each test.
- Restore stubbed environment variables and globals.
- Do not mutate `process.env`, globals, cwd, fake timers, or module state without restoring them.
- Avoid broad `vi.mock()` usage in integration tests.
- Use `vi.resetModules()` only when module-cache behavior is relevant to the scenario. Do not use it as general cleanup.

### Use snapshots sparingly

- Use snapshots only for stable, reviewable contracts such as structured protocol output or large deterministic results.
- Prefer explicit assertions when only a few fields matter.
- Exclude unstable values such as timestamps, random IDs, temporary paths, token counts, or unrelated session metadata from snapshots.
- Never update snapshots merely to make CI pass. Review the behavior change first.

### Preserve the integration-test boundary

- Do not move a test to direct helper invocation merely to make it faster or easier.
- Do not add unit-style tests to the integration suite to increase coverage percentages.
- Coverage does not replace exercising the actual Pi integration boundary.
- If code cannot be reached through a realistic extension scenario, either test it at another test level or reconsider whether it belongs in the integration suite.

### Regression workflow

For an integration bug:

1. Reproduce the bug with the smallest realistic failing integration test.
2. Confirm that the test fails for the expected reason.
3. Fix the production code. Do not weaken the test to accommodate the bug.
4. Run the affected integration test file.
5. Run the complete Vitest integration project.
6. Check that the run exits cleanly without leaked resources.

### Agent acceptance criteria

Before declaring a Pi extension change complete, the agent must:

- identify which integration boundary the change affects
- add or update integration coverage when externally visible behavior changes
- run the smallest relevant integration test first
- run the full integration Vitest project after the focused test passes
- confirm that tests do not depend on live credentials or paid APIs unless the test is explicitly designated as a live smoke test
- confirm that no test leaves files, processes, sockets, timers, listeners, or global state behind
- report any integration scenario that could not be exercised and why

Passing TypeScript compilation or unit tests alone is not sufficient evidence that a Pi extension change works.