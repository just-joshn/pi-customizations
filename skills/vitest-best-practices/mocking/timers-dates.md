# Fake Timers, Dates, and Temporal

## Table of Contents

1. [Enabling Fake Timers](#enabling-fake-timers)
2. [Advancing Time](#advancing-time)
3. [Async Code and Promises](#async-code-and-promises)
4. [Mocking the Current Date](#mocking-the-current-date)
5. [Temporal](#temporal)
6. [node:timers and node:timers/promises](#nodetimers-and-nodetimerspromises)
7. [Choosing What to Fake](#choosing-what-to-fake)
8. [Waiting Helpers and Tick Modes](#waiting-helpers-and-tick-modes)
9. [Time Zones](#time-zones)

## Enabling Fake Timers

`vi.useFakeTimers()` replaces `setTimeout`, `setInterval`, `setImmediate`, their `clear*` counterparts, `Date`, and the other APIs in the default `toFake` list. `vi.useRealTimers()` restores them and **discards** pending fake timers. Fake timers are not undone automatically between tests; always pair them.

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('runs the callback after two hours', () => {
  const cb = vi.fn()
  setTimeout(cb, 2 * 60 * 60 * 1000)

  vi.advanceTimersByTime(2 * 60 * 60 * 1000 - 1)
  expect(cb).not.toHaveBeenCalled()

  vi.advanceTimersByTime(1)
  expect(cb).toHaveBeenCalledTimes(1)
})
```

Install fake timers **before** the code under test schedules its timers. Timers created with real `setTimeout` before `useFakeTimers` are not controlled.

## Advancing Time

| API | Behavior |
| --- | --- |
| `vi.advanceTimersByTime(ms)` | Fire timers due within `ms`, in order |
| `vi.advanceTimersToNextTimer()` | Fire the next timer only; chainable |
| `vi.advanceTimersToNextFrame()` | Advance to the next `requestAnimationFrame` callback |
| `vi.runOnlyPendingTimers()` | Fire timers pending now, not ones they schedule |
| `vi.runAllTimers()` | Fire until the queue is empty; throws after `loopLimit` (10 000) for endless intervals |
| `vi.runAllTicks()` | Flush `process.nextTick` callbacks |
| `vi.clearAllTimers()` | Drop all scheduled timers |
| `vi.getTimerCount()` | Number of pending timers |

Each `*Async` variant (`advanceTimersByTimeAsync`, `advanceTimersToNextTimerAsync`, `runAllTimersAsync`, `runOnlyPendingTimersAsync`) also lets promise callbacks between timers run. Await it.

For intervals and recursive timeouts, prefer `advanceTimersByTime` or `runOnlyPendingTimers`; `runAllTimers` on a never-cleared interval hits the loop limit.

```ts
test('polls every minute', () => {
  const poll = vi.fn()
  setInterval(poll, 60_000)

  vi.advanceTimersToNextTimer()
  expect(poll).toHaveBeenCalledTimes(1)

  vi.advanceTimersByTime(2 * 60_000)
  expect(poll).toHaveBeenCalledTimes(3)
})
```

## Async Code and Promises

Promises and `await` are microtasks, which are not faked by default. Sync advancing doesn't let them run, so a timer scheduled after an `await` isn't registered yet, and code after an `await` in a timer callback hasn't resumed. Use the async variants whenever timers and promises interleave:

```ts
async function retry<T>(fn: () => Promise<T>, delayMs: number): Promise<T> {
  try {
    return await fn()
  }
  catch {
    await new Promise(r => setTimeout(r, delayMs))
    return fn()
  }
}

test('retries after the delay', async () => {
  const fn = vi.fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error('flaky'))
    .mockResolvedValueOnce('ok')

  const result = retry(fn, 1000)

  await vi.advanceTimersByTimeAsync(1000)

  await expect(result).resolves.toBe('ok')
  expect(fn).toHaveBeenCalledTimes(2)
})
```

Start the operation, advance time, then await the result. Awaiting the result first deadlocks: the timer never fires and the test times out.

`process.nextTick` and `queueMicrotask` are only faked when listed in `toFake`. Faking `nextTick` hangs under `pool: 'forks'`; it works with `pool: 'threads'`.

## Mocking the Current Date

`vi.setSystemTime(date)` sets the clock. With fake timers on, it moves `Date`, `performance.now`, and `hrtime` without firing timers. With fake timers off, it mocks only `Date` and `Temporal.Now`. Either way, reset with `vi.useRealTimers()`; the mocked time does not reset between tests on its own.

```ts
function purchase(now = new Date()) {
  const hour = now.getHours()
  return hour > 9 && hour < 17 ? 'Success' : 'Error'
}

describe('business hours', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('allows purchases at 13:00', () => {
    vi.setSystemTime(new Date(2000, 1, 1, 13))
    expect(purchase()).toBe('Success')
  })

  test('rejects purchases at 19:00', () => {
    vi.setSystemTime(new Date(2000, 1, 1, 19))
    expect(purchase()).toBe('Error')
  })
})
```

Start fake timers at a fixed time in one call:

```ts
vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') })
```

Other helpers: `vi.getMockedSystemTime()` (a `Date`, or `null` when not mocked), `vi.getRealSystemTime()` (real epoch ms while faked), `vi.isFakeTimers()`.

## Temporal

**Version note:** since 5.0, fake timers and `vi.setSystemTime` also mock `Temporal` (`Temporal.Now.*` follows the mocked clock). In 4.x `Temporal.Now` kept returning real time. This only applies when `Temporal` exists globally: natively (Node.js ≥ 26 by default) or via a global polyfill such as `import 'temporal-polyfill/global'`.

```ts
vi.useFakeTimers({ now: 0 })
expect(Temporal.Now.instant().epochMilliseconds).toBe(0)

// 5.1+: pass Temporal values directly
vi.setSystemTime(Temporal.Instant.from('2026-11-02T09:00:00Z'))
```

A `Temporal.ZonedDateTime` sets the instant only; it does not change the environment's time zone. Keep `Temporal` real with `vi.useFakeTimers({ toNotFake: ['Temporal'] })`.

## node:timers and node:timers/promises

By default, fake timers replace only globals. Code that imports from `node:timers` or `node:timers/promises` keeps real timers. **Version note:** 5.1 adds `fakeNodeBuiltins` (default `false`, planned to become the default in the next major):

```ts
import { setTimeout as sleep } from 'node:timers/promises'
import { expect, test, vi } from 'vitest'

test('resolves after the delay', async () => {
  vi.useFakeTimers({ fakeNodeBuiltins: true })

  const resolved = vi.fn()
  sleep(1000).then(resolved)

  await vi.advanceTimersByTimeAsync(1000)
  expect(resolved).toHaveBeenCalled()
})
```

## Choosing What to Fake

Pass options to `vi.useFakeTimers()` or set defaults in config under `test.fakeTimers`:

```ts
// only timeouts; Date stays real
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

vi.useFakeTimers({ toNotFake: ['setInterval'] })
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fakeTimers: {
      fakeNodeBuiltins: true,
      loopLimit: 10_000,
    },
  },
})
```

- `toFake` default: everything available globally except `nextTick` and `queueMicrotask`. The list includes `Date`, `performance`, `hrtime`, `requestAnimationFrame`, `requestIdleCallback`, `Intl`, `Temporal`.
- `toFake` and `toNotFake` cannot be combined.
- `shouldAdvanceTime: true` advances fake time along with real time (`advanceTimeDelta`, default 20 ms).

## Waiting Helpers and Tick Modes

With fake timers on, `vi.waitFor` and `vi.waitUntil` advance fake time by `interval` before each check, and `expect.poll` advances after each failed attempt. Each check still waits `interval` of real time, so a large `interval` makes the test slow:

```ts
test('server becomes ready', async () => {
  vi.useFakeTimers()
  startServer() // flips isReady after a 500ms setTimeout

  await vi.waitFor(() => {
    if (!server.isReady)
      throw new Error('not ready')
  }, { timeout: 1000, interval: 20 })
})
```

`vi.setTimerTickMode` makes timers move without explicit advancing:

- `'manual'` (default): only `advanceTimers*`/`run*` and waiting helpers move time.
- `'nextTimerAsync'`: run the next timer after each macrotask. Good for code that eventually settles.
- `'interval'` (optionally with ms): advance by a fixed step on a real-time interval.

## Time Zones

`process.env.TZ` set in a test, setup file, or `test.env` does not affect `Date` in `pool: 'threads'` or `'vmThreads'`. Set `TZ` before workers start: in the shell, the config file, or `globalSetup`.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Real `await sleep(5000)` in tests | Slow and flaky | Fake timers + `advanceTimersByTime` |
| `useFakeTimers` without `useRealTimers` | Fake clock leaks into later tests | Pair in `beforeEach`/`afterEach` |
| Sync `advanceTimersByTime` with promise chains | Callbacks after `await` haven't run when you assert | `await vi.advanceTimersByTimeAsync(ms)` |
| `await result` before advancing time | Timer never fires; test times out | Start, advance, then await |
| `runAllTimers()` with a never-cleared interval | Throws after the loop limit | `advanceTimersByTime` or `runOnlyPendingTimers` |
| Expecting `node:timers/promises` to be faked | Real timers by default | `fakeNodeBuiltins: true` (5.1+) |
| `vi.setSystemTime` and forgetting to reset | Mocked date leaks to the next test | `vi.useRealTimers()` in `afterEach` |
| Assuming `Temporal.Now` is real time under fake timers | Mocked since 5.0 | `toNotFake: ['Temporal']` if you need it real |
| `process.env.TZ = ...` inside a test | No effect in thread pools | Set `TZ` before Vitest starts |
| Large `interval` in `vi.waitFor` with fake timers | Each check still waits that long in real time | Small `interval` |

## Related References

- **Async tests, waitFor, expect.poll**: See [async-testing.md](../core/async-testing.md)
- **Mock functions used as timer callbacks**: See [mock-functions.md](mock-functions.md)
- **Configuring defaults**: See [configuration.md](../core/configuration.md)
- **Flaky timing-dependent tests**: See [flaky-tests.md](../debugging/flaky-tests.md)
- **Pools and threads**: See [performance.md](../infrastructure-ci-cd/performance.md)
