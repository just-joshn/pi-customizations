# Async Testing

## Table of Contents

1. [Awaiting Promises](#awaiting-promises)
2. [resolves and rejects](#resolves-and-rejects)
3. [Callback APIs](#callback-apis)
4. [Timeouts](#timeouts)
5. [Waiting for Conditions](#waiting-for-conditions)
6. [Unhandled Errors and Rejections](#unhandled-errors-and-rejections)
7. [Cancellation with the Test Signal](#cancellation-with-the-test-signal)
8. [Auto-Cleanup with using](#auto-cleanup-with-using)
9. [Leaking Async Work](#leaking-async-work)

## Awaiting Promises

Make the test `async` and `await` the code under test. Vitest waits for the returned promise. A rejection fails the test with the rejection reason.

```ts
import { expect, test } from 'vitest'
import { fetchUser } from './users'

test('fetchUser returns the user by id', async () => {
  const user = await fetchUser(1)
  expect(user).toMatchObject({ id: 1, name: 'Alice' })
})
```

Every promise a test starts must be awaited or returned. A promise left floating either settles after the test has finished (so its assertions are lost) or rejects as an unhandled error after the test has moved on.

```ts
import { expect, test } from 'vitest'
import { fetchUser, saveUser } from './users'

test('saves both users', async () => {
  await Promise.all([saveUser({ id: 1 }), saveUser({ id: 2 })])
  expect(await fetchUser(2)).toBeDefined()
})
```

## resolves and rejects

`.resolves` and `.rejects` unwrap a promise and then apply the matcher. The matcher then returns a promise, so **always `await` it**.

```ts
import { expect, test } from 'vitest'
import { fetchUser } from './users'

test('resolves to Alice', async () => {
  await expect(fetchUser(1)).resolves.toMatchObject({ name: 'Alice' })
})

test('rejects for a missing user', async () => {
  await expect(fetchUser(999)).rejects.toThrow('User not found')
})

test('rejects with a typed error', async () => {
  await expect(fetchUser(-1)).rejects.toMatchObject({ name: 'ValidationError', field: 'id' })
})
```

> **Version note:** In 5.x an unawaited async assertion (`resolves`, `rejects`, `toMatchFileSnapshot`, `expect.poll`) **fails the test** and the error points at the assertion. In 4.x it was awaited automatically and only printed a warning. Code ported from 4.x or Jest that "passed" may start failing. The fix is to add `await`.

To assert both that a call rejects and what the error contains, `rejects` is shorter than `try/catch`. If you need `try/catch`, add `expect.assertions(n)` so a promise that resolves cannot pass silently:

```ts
import { expect, test } from 'vitest'
import { ApiError, fetchUser } from './users'

test('error carries the status code', async () => {
  expect.assertions(2)
  try {
    await fetchUser(999)
  }
  catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(404)
  }
})
```

## Callback APIs

There is no `done` callback. Wrap the callback API in a `Promise` and await it:

```ts
import { expect, test } from 'vitest'
import { readConfig } from './legacy'

test('readConfig yields parsed config', async () => {
  const config = await new Promise((resolve, reject) => {
    readConfig('app.json', (err, value) => (err ? reject(err) : resolve(value)))
  })
  expect(config).toMatchObject({ name: 'app' })
})
```

For event emitters, `once` from `node:events` returns a promise:

```ts
import { once } from 'node:events'
import { expect, test } from 'vitest'
import { createWorker } from './worker'

test('worker emits ready', async () => {
  const worker = createWorker()
  const [info] = await once(worker, 'ready')
  expect(info.pid).toBeTypeOf('number')
})
```

## Timeouts

| Setting | Default (Node) | Default (browser mode) | Scope |
| --- | --- | --- | --- |
| `testTimeout` | 5000 ms | 15000 ms | Each test |
| `hookTimeout` | 10000 ms | 30000 ms | Each `before*`/`after*`/`around*` hook |
| `teardownTimeout` | 10000 ms | | Vitest shutdown |

`0` disables a timeout. Raise the timeout for the narrowest scope that needs it:

```ts
import { beforeAll, describe, test } from 'vitest'
import { importFixtures, startDatabase } from './db'

beforeAll(async () => {
  await startDatabase()
}, 60_000)                                         // hook timeout as last arg

test('imports 100k rows', { timeout: 30_000 }, async () => {
  await importFixtures('large.csv')
})

describe('slow suite', { timeout: 20_000 }, () => {
  test('inherits 20s', async () => { /* ... */ })
})
```

```bash
npx vitest run --testTimeout=20000 --hookTimeout=30000
```

A timeout usually means a promise that never settles (a missing `await`, an event that never fires, a server that never started), not code that is slow. Find which await hangs before you raise the limit. `aroundEach`/`aroundAll` timeouts apply to the setup and teardown phases separately.

## Waiting for Conditions

Do not `await sleep(500)`. Retry until the condition holds:

```ts
import { expect, test, vi } from 'vitest'
import { server } from './server'

test('server becomes ready', async () => {
  server.start()
  await expect.poll(() => server.isReady, { timeout: 2000 }).toBe(true)
  const health = await vi.waitFor(() => server.health(), { message: 'health endpoint up' })
  expect(health.status).toBe('ok')
})
```

See [assertions.md](assertions.md#waiting-expectpoll-viwaitfor-viwaituntil) to choose between `expect.poll`, `vi.waitFor`, and `vi.waitUntil`. With fake timers, all three advance the clock automatically. See [timers-dates.md](../mocking/timers-dates.md).

## Unhandled Errors and Rejections

Unhandled rejections and uncaught errors **fail the run**, even when every assertion passed. They usually mean a forgotten `await` or a fire-and-forget promise.

```ts
import { expect, test } from 'vitest'
import { notify, sendEmail } from './mailer'

test('bad: fire-and-forget', () => {
  sendEmail('a@b.com')             // rejects later -> unhandled error
})

test('good: await or handle', async () => {
  await expect(sendEmail('bad')).rejects.toThrow('invalid address')
  notify().catch(() => {})         // intentionally ignored rejection
})
```

When the code is supposed to produce a specific unhandled error, filter it in config instead of turning the check off:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    onUnhandledError(error) {
      if (error.name === 'ExpectedShutdownError') return false // ignore just this one
    },
  },
})
```

`dangerouslyIgnoreUnhandledErrors: true` keeps them from failing the run (reporters still print them). It is a last resort.

## Cancellation with the Test Signal

The test context provides `signal`, an `AbortSignal` that Vitest aborts when the test times out, when the run is cancelled (Ctrl+C), or when another test fails under `--bail`. Pass it to anything that accepts a signal so resources are released instead of keeping the worker busy.

```ts
import { test } from 'vitest'

test('stops the request when the test times out', async ({ signal }) => {
  await fetch('http://localhost:4000/slow', { signal })
}, 2000)

async function pollUntilReady(url: string, signal: AbortSignal) {
  while (!signal.aborted) {
    const res = await fetch(url, { signal })
    if (res.ok) return
    await new Promise(r => setTimeout(r, 200))
  }
  signal.throwIfAborted()
}

test('service becomes healthy', async ({ signal }) => {
  await pollUntilReady('http://localhost:4000/health', signal)
}, 5000)
```

APIs that accept `{ signal }` include `fetch`, `addEventListener`, `child_process.spawn`, `fs/promises.readFile`, and `node:timers/promises`.

## Auto-Cleanup with using

If the runtime supports Explicit Resource Management (TypeScript 5.2+; native in Node 24+), declare spies with `using`. They are restored when the block exits, even partway through a test. This works for `vi.spyOn`, `vi.fn`, and `vi.doMock`.

```ts
import { expect, test, vi } from 'vitest'
import { login, preloadConfig } from './auth'

test('mocks fetch only for the login call', async () => {
  await preloadConfig()                             // real fetch

  {
    using fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}'))
    await login('alice', 'secret')
    expect(fetchSpy).toHaveBeenCalledOnce()
  }
  // real fetch restored here
})
```

Without `using`, register the cleanup with `onTestFinished(() => spy.mockRestore())` ([fixtures-hooks.md](fixtures-hooks.md)).

## Leaking Async Work

Timers, sockets, or intervals that outlive a test can make a later test flaky or keep the process alive. To find them, run once with `--detectAsyncLeaks`. It is slow, so use it only while debugging. Vitest then reports each leaked resource with the line that created it.

```bash
npx vitest run src/checkout.test.ts --detectAsyncLeaks
```

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `expect(p).resolves.toBe(1)` without `await` | Fails in 5.x. In older versions it ran after the test ended | `await expect(p).resolves...` |
| Calling an async function without `await` | Assertions lost, or an unhandled rejection fails the run | `await`, `return`, or `Promise.all` |
| `test('x', (done) => ...)` | No `done` callback in Vitest | Wrap in `new Promise` |
| `try { await f() } catch (e) { expect(e)... }` without a count | Passes if `f` resolves | `await expect(f()).rejects...` or `expect.assertions(n)` |
| `await sleep(1000)` before asserting | Slow and still flaky | `expect.poll` / `vi.waitFor` |
| Raising `testTimeout` globally to fix one test | Hides hangs everywhere | Per-test `{ timeout }`, and find the stuck await |
| `dangerouslyIgnoreUnhandledErrors: true` | Hides real bugs | Fix the floating promise or filter with `onUnhandledError` |
| Ignoring `signal` in long network or process calls | The worker hangs past the timeout | Pass the context `signal` |

## Related References

- **Assertions, waiting helpers**: [assertions.md](assertions.md)
- **Hooks and cleanup**: [fixtures-hooks.md](fixtures-hooks.md)
- **Fake timers**: [timers-dates.md](../mocking/timers-dates.md)
- **Async error paths**: [error-testing.md](../testing-patterns/error-testing.md)
- **Timeouts, hangs, flakiness**: [flaky-tests.md](../debugging/flaky-tests.md)
- **Network mocking**: [network-requests.md](../mocking/network-requests.md)
