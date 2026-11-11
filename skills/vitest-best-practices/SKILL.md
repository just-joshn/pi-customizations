---
name: vitest-best-practices
description: Use when writing or reviewing Vitest tests, fixing flaky or slow tests, debugging failures, structuring suites, writing assertions (toBe vs toEqual vs toStrictEqual, asymmetric matchers, expect.soft, expect.poll, vi.waitFor), testing async code, setup/teardown hooks, test context and fixtures (test.extend, aroundEach), mocking (vi.fn, vi.spyOn, vi.mock, vi.hoisted, vi.when, classes), fake timers and dates, globals and env stubs, network mocking with MSW, file system mocking, snapshots, type testing (expectTypeOf), DOM environments (jsdom, happy-dom), Browser Mode, component testing (React, Vue, Svelte), benchmarking, database/integration tests, test tags and filtering, configuration and projects (monorepos), parallelism and performance, coverage, reporters, CI sharding, or migrating from Jest or Vitest 4. Targets Vitest 5.x.
license: MIT
metadata:
  version: "1.0"
  vitest: "5.1.0"
---

# Vitest Best Practices

Guidance for writing, debugging, and maintaining Vitest test suites. Written against **Vitest 5.1**. Check the project's installed version first (`npx vitest --version`). APIs and defaults changed in 5.0 (for example `clearMocks` is on by default, `describe.sequential` is gone, unawaited async assertions fail). See [migration.md](architecture/migration.md) when a project is on 4.x or Jest.

## Activity-Based Reference Guide

### Writing New Tests

| Activity                              | Reference Files                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Writing unit tests**                | [test-structure.md](core/test-structure.md), [assertions.md](core/assertions.md)                                  |
| **Testing async code**                | [async-testing.md](core/async-testing.md), [assertions.md](core/assertions.md)                                    |
| **Parameterized tests**               | [test-structure.md](core/test-structure.md)                                                                       |
| **Setup, teardown, fixtures**         | [fixtures-hooks.md](core/fixtures-hooks.md), [test-data.md](core/test-data.md)                                    |
| **Testing errors and failure paths**  | [error-testing.md](testing-patterns/error-testing.md), [assertions.md](core/assertions.md)                         |
| **Snapshot tests**                    | [snapshots.md](testing-patterns/snapshots.md)                                                                     |
| **Type-level tests**                  | [type-testing.md](testing-patterns/type-testing.md)                                                               |
| **Testing DOM code in Node**          | [dom-environments.md](testing-patterns/dom-environments.md)                                                       |
| **Testing in a real browser**         | [browser-mode.md](testing-patterns/browser-mode.md)                                                               |
| **Component tests**                   | [component-testing.md](testing-patterns/component-testing.md), [browser-mode.md](testing-patterns/browser-mode.md) |
| **Database / integration tests**      | [integration-testing.md](testing-patterns/integration-testing.md), [fixtures-hooks.md](core/fixtures-hooks.md)    |
| **Benchmarks**                        | [benchmarking.md](testing-patterns/benchmarking.md)                                                               |
| **Tests next to source (in-source)**  | [test-structure.md](core/test-structure.md)                                                                       |
| **Test data factories**               | [test-data.md](core/test-data.md)                                                                                 |

### Mocking

| Activity                                 | Reference Files                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Mock functions, spies, classes**       | [mock-functions.md](mocking/mock-functions.md)                                           |
| **Mocking modules / partial mocks**      | [module-mocking.md](mocking/module-mocking.md)                                           |
| **Fake timers, dates, Temporal**         | [timers-dates.md](mocking/timers-dates.md)                                               |
| **Globals and environment variables**    | [globals-env.md](mocking/globals-env.md)                                                 |
| **HTTP / fetch / WebSocket requests**    | [network-requests.md](mocking/network-requests.md)                                       |
| **File system**                          | [file-system.md](mocking/file-system.md)                                                 |
| **Deciding whether to mock**             | [when-to-mock.md](architecture/when-to-mock.md)                                          |

### Framework-Specific Testing

| Activity                 | Reference Files                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **React**                | [react.md](frameworks/react.md), [component-testing.md](testing-patterns/component-testing.md)    |
| **Vue**                  | [vue.md](frameworks/vue.md), [component-testing.md](testing-patterns/component-testing.md)        |
| **Svelte**               | [svelte.md](frameworks/svelte.md), [component-testing.md](testing-patterns/component-testing.md)  |

### Debugging & Troubleshooting

| Activity                                  | Reference Files                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Debugging a failing test**              | [debugging.md](debugging/debugging.md)                                                                   |
| **Flaky tests, state leaks, test order**  | [flaky-tests.md](debugging/flaky-tests.md), [fixtures-hooks.md](core/fixtures-hooks.md)                  |
| **Error messages and setup problems**     | [common-errors.md](debugging/common-errors.md)                                                           |
| **Timeouts / hanging tests**              | [async-testing.md](core/async-testing.md), [flaky-tests.md](debugging/flaky-tests.md)                    |

### Organizing & Running Tests

| Activity                                  | Reference Files                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **skip / only / todo / fails / skipIf**   | [annotations-filtering.md](core/annotations-filtering.md)                                          |
| **Tags and filtering by name or file**    | [annotations-filtering.md](core/annotations-filtering.md)                                          |
| **Configuring Vitest**                    | [configuration.md](core/configuration.md)                                                          |
| **Monorepos and multiple projects**       | [projects.md](core/projects.md), [configuration.md](core/configuration.md)                         |

### Architecture Decisions

| Activity                                  | Reference Files                                                     |
| ----------------------------------------- | ------------------------------------------------------------------- |
| **Unit vs integration vs browser vs E2E** | [test-architecture.md](architecture/test-architecture.md)           |
| **Mock vs real dependency**               | [when-to-mock.md](architecture/when-to-mock.md)                     |
| **Migrating from Jest or Vitest 4**       | [migration.md](architecture/migration.md)                           |

### Infrastructure & CI

| Activity                                  | Reference Files                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **CI setup, sharding, merging reports**   | [ci.md](infrastructure-ci-cd/ci.md)                                                                                     |
| **Speeding up the suite**                 | [performance.md](infrastructure-ci-cd/performance.md)                                                                   |
| **Pools, workers, isolation**             | [performance.md](infrastructure-ci-cd/performance.md), [flaky-tests.md](debugging/flaky-tests.md)                       |
| **Coverage**                              | [coverage.md](infrastructure-ci-cd/coverage.md)                                                                         |
| **Reporters and output files**            | [reporters.md](infrastructure-ci-cd/reporters.md)                                                                       |

## Quick Decision Tree

```
What are you doing?
│
├─ Writing a new test?
│  ├─ Pure function / module → core/test-structure.md, core/assertions.md
│  ├─ Async code → core/async-testing.md
│  ├─ Same logic, many inputs → core/test-structure.md (test.for / test.each)
│  ├─ Needs shared setup or resources → core/fixtures-hooks.md
│  ├─ DOM code, fast feedback → testing-patterns/dom-environments.md
│  ├─ Real browser behavior → testing-patterns/browser-mode.md
│  ├─ UI component → testing-patterns/component-testing.md, frameworks/react.md, frameworks/vue.md, frameworks/svelte.md
│  ├─ Talks to a database → testing-patterns/integration-testing.md
│  ├─ Public types → testing-patterns/type-testing.md
│  └─ Large structured output → testing-patterns/snapshots.md
│
├─ Need to replace a dependency?
│  ├─ Should I mock at all? → architecture/when-to-mock.md
│  ├─ A function or method → mocking/mock-functions.md
│  ├─ An imported module → mocking/module-mocking.md
│  ├─ Time / Date / timers → mocking/timers-dates.md
│  ├─ window, globals, process.env → mocking/globals-env.md
│  ├─ HTTP / fetch → mocking/network-requests.md
│  └─ fs → mocking/file-system.md
│
├─ Test is failing or flaky?
│  ├─ Need a debugger → debugging/debugging.md
│  ├─ Passes alone, fails in the suite → debugging/flaky-tests.md
│  ├─ Timeout / hang → core/async-testing.md, debugging/flaky-tests.md
│  ├─ Mock not applied → mocking/module-mocking.md, debugging/common-errors.md
│  └─ Cryptic error → debugging/common-errors.md
│
├─ Setting up or tuning?
│  ├─ Config file → core/configuration.md
│  ├─ Monorepo / mixed environments → core/projects.md
│  ├─ Slow suite → infrastructure-ci-cd/performance.md
│  ├─ CI / sharding → infrastructure-ci-cd/ci.md
│  ├─ Coverage → infrastructure-ci-cd/coverage.md
│  └─ Reporters → infrastructure-ci-cd/reporters.md
│
└─ Upgrading?
   └─ Jest → Vitest, or Vitest 4 → 5 → architecture/migration.md
```

## Test Validation Loop

After writing or modifying tests:

1. **Run the affected tests once, not in watch mode**: `npx vitest run path/to/file.test.ts`
2. **If a test fails**: read the assertion diff and stack trace, isolate with `-t "<name>"` or `.only`, fix, re-run. See [debugging.md](debugging/debugging.md).
3. **Type-check separately**: `vitest run` does not type-check. Run `tsc --noEmit` (or `vitest --typecheck` for type tests).
4. **Run the full suite** to catch state leaking between files.
5. **For flaky-prone tests**, repeat them: `npx vitest run path/to/file.test.ts --repeats=10`, or shuffle order with `--sequence.shuffle`. See [flaky-tests.md](debugging/flaky-tests.md).
6. **Remove `.only` and debug code** before finishing. `--allowOnly=false` (the CI default) fails a run that still has `.only`.
