# Flaky Tests

## Table of Contents

1. [Flakiness Categories](#flakiness-categories)
2. [Reproducing Flakiness](#reproducing-flakiness)
3. [Shared State and Order Dependence](#shared-state-and-order-dependence)
4. [Mock State Between Tests](#mock-state-between-tests)
5. [Async, Timers, and Leaks](#async-timers-and-leaks)
6. [Concurrency](#concurrency)
7. [Parallel Workers and Shared Resources](#parallel-workers-and-shared-resources)
8. [Retries: Last Resort](#retries-last-resort)

## Flakiness Categories

| Category | Symptom | Common causes |
| --- | --- | --- |
| **Order-dependent** | Passes alone, fails in suite or when shuffled | Module-level state, unrestored spies/globals/env, `isolate: false` |
| **Timing** | Intermittent timeouts or wrong values | Missing `await`, real timers/sleeps, unflushed promises |
| **Parallelism** | Fails only with many workers | Shared DB/files/ports between workers |
| **Concurrency** | Fails with `test.concurrent` | Global `expect` in concurrent tests, mock auto-clear across running tests |
| **External** | Random failures | Real network, real clock, time zone, random data |

```
Test fails intermittently
├─ Fails alone with --repeats? → timing / external → Async, Timers; mock network & time
├─ Fails only after other tests or with --sequence.shuffle? → shared state
├─ Fails only with many workers? → per-worker resources
└─ Fails only with concurrent tests? → context expect, mock cleanup
```

## Reproducing Flakiness

```bash
# Repeat each test N extra times; any failing repetition fails the test
vitest run src/cart.test.ts --repeats=20

# Randomize file and test order; the header prints: Running tests with seed "..."
vitest run --sequence.shuffle

# Replay the exact order
vitest run --sequence.shuffle --sequence.seed=1712345678

# Shuffle only tests within files
vitest run --sequence.shuffle.tests

# Rule out parallelism
vitest run --no-file-parallelism

# Rerun only what failed last time (5.1)
vitest run --last-failed
```

`repeats` is also a test option for targeting a single suspicious test:

```ts
import { expect, test } from 'vitest'

test('debounces input', { repeats: 50 }, async () => {
  expect(await search('ab')).toEqual(['abc'])
})
```

For waits that sometimes time out, enable `experimental.traceTimeline` (5.1) to print the `expect.poll`/`vi.waitFor`/`vi.waitUntil` steps and durations under the failure. See [debugging.md](debugging.md).

## Shared State and Order Dependence

The most common cause: one test mutates module-level state and another depends on it.

```ts
// BAD: shared array across tests
const users: string[] = []

test('adds a user', () => {
  users.push('Ada')
  expect(users).toEqual(['Ada'])
})

test('starts empty', () => {
  expect(users).toEqual([]) // fails after the test above
})
```

Give every test fresh state with a fixture:

```ts
import { test as baseTest, expect } from 'vitest'

const test = baseTest.extend('users', () => [] as string[])

test('adds a user', ({ users }) => {
  users.push('Ada')
  expect(users).toEqual(['Ada'])
})

test('starts empty', ({ users }) => {
  expect(users).toEqual([])
})
```

Other leak sources and their fixes:

| Leak | Fix |
| --- | --- |
| `vi.stubGlobal` / `vi.stubEnv` | `unstubGlobals: true` / `unstubEnvs: true` (both default `false`) |
| `vi.useFakeTimers()` | `vi.useRealTimers()` in `afterEach` |
| Module-level caches/singletons | Export a reset function, or `vi.resetModules()` + dynamic import |
| DOM left over between tests | Use the renderer's auto-cleanup; don't share DOM across tests |
| Real files/DB rows | Per-test fixture with `onCleanup` |

### Isolation

`isolate` (default `true`) runs each test file in a fresh module environment, so module state can't leak **between files**. It does nothing for leaks **between tests in the same file**. Turning it off (`--no-isolate`) speeds up suites but lets module state, globals, and worker-scoped fixtures leak across files. If flakiness appears after disabling isolation, re-enable it for the affected [project](../core/projects.md) rather than globally.

## Mock State Between Tests

**Version note (5.x):** `clearMocks` defaults to `true`. Vitest calls `vi.clearAllMocks()` before every test, clearing call history but **not** implementations or spies.

| Option | Default | Before each test |
| --- | --- | --- |
| `clearMocks` | `true` | Clears call history |
| `mockReset` | `false` | Clears history and resets implementations |
| `restoreMocks` | `false` | Restores originals of `vi.spyOn` spies |

So a `mockReturnValue` set in one test still applies in the next, and a `vi.spyOn` keeps replacing the method. Either reset in config or restore explicitly:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
})
```

```ts
import { afterEach, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})
```

See [mock-functions.md](../mocking/mock-functions.md).

## Async, Timers, and Leaks

- Await every async assertion. **Version note (5.x):** unawaited `.resolves`, `.rejects`, `toMatchFileSnapshot`, and `expect.poll` fail the test; `expect.poll` also fails on timeout.
- Replace fixed sleeps with retrying waits:

```ts
import { expect, test, vi } from 'vitest'

test('job completes', async () => {
  startJob()
  // BAD: await new Promise(r => setTimeout(r, 500))
  await expect.poll(() => getJobStatus(), { timeout: 2000 }).toBe('done')
  await vi.waitFor(() => expect(logs()).toContain('job done'), { message: 'job logged' })
})
```

- Control time instead of racing it: `vi.useFakeTimers()`, `vi.advanceTimersByTimeAsync()`, `vi.setSystemTime()`. See [timers-dates.md](../mocking/timers-dates.md).
- Set `TZ` before workers start (shell, config file, or `globalSetup`). Setting `process.env.TZ` in a test has no effect in `threads`/`vmThreads` pools.

### Finding leaked async work

Timers, sockets, or handles that outlive a test can fire during *another* test and break it.

```bash
vitest run --detectAsyncLeaks
```

`detectAsyncLeaks` uses `node:async_hooks` to report resources not cleaned up, with the creating code frame (e.g. a `setTimeout` in a `useEffect` without cleanup). It's slow; use it only while debugging.

## Concurrency

`test.concurrent` / `describe.concurrent` / `sequence.concurrent` run async tests in parallel within a file.

- Use the context `expect` for assertions and snapshots so failures attach to the right test.
- `clearMocks` (default on), `mockReset`, and `restoreMocks` act on **all** mocks globally, so one test's lifecycle can clear or restore mocks another concurrent test is still using. Create mocks per test and don't assert call counts on shared mocks.
- Opt one test out of inherited concurrency with `{ concurrent: false }`. **Version note (5.0):** `test.sequential` and `describe.sequential` were removed.

```ts
import { describe, test } from 'vitest'

describe.concurrent('pricing', () => {
  test('adds tax', async ({ expect }) => {
    expect(await price(100, 'DE')).toBe(119)
  })

  test('snapshot of invoice', async ({ expect }) => {
    expect(await renderInvoice()).toMatchSnapshot()
  })

  test('writes the shared ledger file', { concurrent: false }, async ({ expect }) => {
    expect(await appendLedger('x')).toBe(true)
  })
})
```

## Parallel Workers and Shared Resources

Files run in parallel workers. Anything outside the process (DB, files, ports) must be partitioned per worker.

```ts
import { test as baseTest } from 'vitest'

export const test = baseTest.extend('db', { scope: 'worker' }, async ({}, { onCleanup }) => {
  // VITEST_POOL_ID is 1..maxWorkers (1-based since 5.0)
  const db = await createDatabase(`app_test_${process.env.VITEST_POOL_ID}`)
  onCleanup(() => db.drop())
  return db
})
```

- **Version note (5.0):** `VITEST_POOL_ID` and `VITEST_WORKER_ID` are 1-based. Code that indexed arrays with them from `0` breaks.
- Use unique temp dirs and port `0` (OS-assigned) instead of fixed paths/ports.
- With `isolate: false`, worker-scoped fixtures are shared across files in that worker; otherwise `file` and `worker` scopes behave the same.

## Retries: Last Resort

Retries hide bugs. Fix the cause first; retry only for genuinely external instability, and narrowly.

```ts
import { test } from 'vitest'

test(
  'talks to the staging queue',
  { retry: { count: 2, delay: 500, condition: /ECONNREFUSED|ETIMEDOUT/ } },
  async () => {
    await publishAndConsume()
  },
)
```

- `retry` accepts a number or `{ count, delay, condition }`. A function `condition` only works in test files, not config.
- **5.1:** the default reporter prints one header listing the failed attempts (`(initial run, 1st retry, 2nd retry)`). Custom reporters can call `TestCase.attempts()` to flag tests that passed only after a retry, which is the list of flaky tests to fix.

```ts
// flaky-reporter.ts
import type { Reporter } from 'vitest/node'

export default {
  onTestCaseResult(testCase) {
    const attempts = testCase.attempts()
    if (testCase.result().state === 'passed' && attempts.length > 1) {
      console.warn(`FLAKY: ${testCase.fullName} passed after ${attempts.length} attempts`)
    }
  },
} satisfies Reporter
```

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Global `retry: 3` to "stabilize" CI | Hides real bugs and races | Fix root cause; narrow `retry` with `condition` |
| `setTimeout` sleeps in tests | Too short on CI, wasteful locally | `expect.poll`, `vi.waitFor`, fake timers |
| Module-level mutable fixtures | Order-dependent results | `test.extend` per-test fixtures |
| Assuming `clearMocks` resets implementations | `mockReturnValue` leaks into next test | `mockReset` / `restoreMocks` or explicit restore |
| Global `expect` in concurrent tests | Wrong test gets the failure/snapshot | Context `({ expect })` |
| Shared DB/port across workers | Collisions under parallelism | Partition by `VITEST_POOL_ID`, port `0` |
| `VITEST_POOL_ID` used as a 0-based index | Off-by-one in 5.x | Treat as 1-based |
| Disabling `isolate` globally for speed | Cross-file leaks | Disable per project after verifying |
| Real network/clock/time zone | External nondeterminism | MSW, fake timers, fixed `TZ` |

## Related References

- [debugging.md](debugging.md) - isolating and inspecting failures
- [fixtures-hooks.md](../core/fixtures-hooks.md) - `test.extend`, scopes, cleanup
- [async-testing.md](../core/async-testing.md) - awaiting, polling, timeouts
- [mock-functions.md](../mocking/mock-functions.md) - clear vs reset vs restore
- [timers-dates.md](../mocking/timers-dates.md) - fake timers, system time
- [globals-env.md](../mocking/globals-env.md) - stubbing and unstubbing
- [performance.md](../infrastructure-ci-cd/performance.md) - pools, isolation, workers
