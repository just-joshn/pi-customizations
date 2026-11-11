# Error Testing

## Table of Contents

1. [Synchronous Throws with toThrow](#synchronous-throws-with-tothrow)
2. [What the toThrow Argument Means](#what-the-tothrow-argument-means)
3. [Async Rejections](#async-rejections)
4. [Error Class, Message, and Cause](#error-class-message-and-cause)
5. [Assertions in catch Blocks](#assertions-in-catch-blocks)
6. [Snapshotting Error Output](#snapshotting-error-output)
7. [Testing Error Logging](#testing-error-logging)
8. [Unhandled Errors and Rejections](#unhandled-errors-and-rejections)
9. [Config Escape Hatches (Use with Caution)](#config-escape-hatches-use-with-caution)

## Synchronous Throws with toThrow

Wrap the call in a function. If you pass the result of the call, the error is thrown before `expect` runs, and the test fails with an uncaught error instead of a useful assertion.

```ts
import { expect, test } from 'vitest'
import { parseAmount } from './money'

test('rejects non-numeric input', () => {
  expect(() => parseAmount('abc')).toThrow('Invalid amount') // ✅
  // expect(parseAmount('abc')).toThrow()                     // ❌ throws before expect sees it
})
```

`toThrowError` is a deprecated alias of `toThrow`. Use `toThrow` in new code.

## What the toThrow Argument Means

| Argument | Passes when |
| --- | --- |
| none | anything is thrown |
| `string` | the error message **contains** the substring |
| `RegExp` | the error message matches the pattern |
| error class (constructor) | the thrown value is `instanceof` that class |
| `Error` instance | the thrown error deep-equals it (name, message, cause are compared) |
| asymmetric matcher | the matcher accepts the thrown value |
| any other value | the thrown value deep-equals it (for non-`Error` throws) |

```ts
import { expect, test } from 'vitest'

class ValidationError extends Error {
  constructor(message: string, readonly field: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

function validate(email: string) {
  if (!email.includes('@')) throw new ValidationError('Email is invalid', 'email')
}

test('toThrow forms', () => {
  expect(() => validate('nope')).toThrow(ValidationError) // class
  expect(() => validate('nope')).toThrow('invalid') // substring
  expect(() => validate('nope')).toThrow(/^Email is invalid$/) // exact message
  expect(() => validate('nope')).toThrow(expect.objectContaining({ field: 'email' }))
  expect(() => { throw 42 }).toThrow(42) // non-Error values
})
```

**Version note (5.0):** `toThrow('')` now matches **any** message, because every string contains the empty string. In 4.x it meant "empty message". To assert an empty message, use `toThrow(/^$/)`.

```ts
expect(() => { throw new Error('boom') }).toThrow('') // passes in 5.x
expect(() => { throw new Error('boom') }).not.toThrow(/^$/) // message is not empty
```

A substring match is loose: `toThrow('id')` also passes for "Invalid input". Use a RegExp anchored with `^...$`, or the class plus a message check, when the exact error matters.

## Async Rejections

Use `.rejects` and **await it**. In 5.x an unawaited `.rejects`/`.resolves` assertion fails the test; it is no longer auto-awaited with a warning.

```ts
import { expect, test } from 'vitest'
import { fetchUser } from './users'

test('rejects for a missing user', async () => {
  await expect(fetchUser('missing')).rejects.toThrow('User missing not found')
  await expect(fetchUser('missing')).rejects.toBeInstanceOf(NotFoundError)
})
```

- `.rejects` takes a promise. A function that returns a promise also works (`expect(() => fetchUser('x')).rejects`).
- If the promise resolves, the `.rejects` assertion fails.
- With fake timers, a promise that rejects *during* `vi.advanceTimersByTimeAsync` is reported as an unhandled rejection even if you assert on it later. Create the assertion before advancing, then await it:

```ts
import { expect, test, vi } from 'vitest'

test('retry gives up after the timeout', async () => {
  vi.useFakeTimers()
  const assertion = expect(retryWithTimeout(task)).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(5_000)
  await assertion
})
```

The other documented option is `vi.setTimerTickMode('nextTimerAsync')` in `beforeEach`, so timers advance on their own and no manual advance is needed. See [timers-dates.md](../mocking/timers-dates.md).

## Error Class, Message, and Cause

When you need several properties of the same error, capture it once and narrow it with `expect.assert`, which throws at runtime and narrows the TypeScript type (unlike `toBeTruthy`/`toBeInstanceOf`).

```ts
import { expect, test } from 'vitest'
import { HttpError, request } from './http'

test('wraps network failures with a cause', async () => {
  const error = await request('/users').catch((e: unknown) => e)

  expect.assert(error instanceof HttpError) // fails if it resolved or threw something else
  expect(error.status).toBe(503)
  expect(error.message).toMatch(/service unavailable/i)
  expect(error.cause).toMatchObject({ code: 'ECONNREFUSED' })
})
```

For a single-line check, an asymmetric matcher inside `toThrow`/`rejects.toThrow` works too:

```ts
await expect(request('/users')).rejects.toThrow(
  expect.objectContaining({ status: 503, cause: expect.objectContaining({ code: 'ECONNREFUSED' }) }),
)
```

Equality on `Error` objects (`toEqual`, `toThrow(new Error(...))`) compares `name`, `message`, `cause`, and `AggregateError.errors`. The `cause` comparison is asymmetric: an expected error **without** a cause matches an actual error that has one, but not the other way round.

```ts
expect(new Error('hi', { cause: 'x' })).toEqual(new Error('hi')) // passes
expect(new Error('hi')).toEqual(new Error('hi', { cause: 'x' })) // fails
```

## Assertions in catch Blocks

Prefer `toThrow`/`rejects`. If you must use `try/catch` (for example to check several error variants in a loop), guard against the "nothing was thrown" path, or the test passes without asserting anything.

```ts
import { expect, test } from 'vitest'

test.for(['no-src', 'no-pkg'])('build fails for %s', async (dir) => {
  expect.assertions(2) // fails if the catch block never runs
  try {
    await build(dir)
  }
  catch (error) {
    expect(error).toBeInstanceOf(BuildError)
    expect((error as BuildError).dir).toBe(dir)
  }
})
```

Alternatives:

- `expect.hasAssertions()` — at least one assertion must run.
- `expect.unreachable('should have thrown')` or `expect.fail('...')` right after the call inside `try`.
- In `test.concurrent`, use the context `expect` (`async ({ expect }) => ...`) so assertion counting is attributed to the right test.

## Snapshotting Error Output

For long or formatted messages, `toThrowErrorMatchingInlineSnapshot` records the error inline. Vitest snapshots the error the same way as `toMatchInlineSnapshot` (`[Error: message]`), not just the message string as Jest does.

```ts
import { expect, test } from 'vitest'

test('explains a parse failure', () => {
  expect(() => parse('{')).toThrowErrorMatchingInlineSnapshot(
    `[SyntaxError: Unexpected end of input at position 1]`,
  )
})
```

See [snapshots.md](snapshots.md) for when snapshots fit and how to review updates.

## Testing Error Logging

When the contract is "log and continue", spy on `console` and silence it. `clearMocks` is on by default in 5.x (call history is cleared before each test), but `restoreMocks` is off, so restore the spy yourself.

```ts
import { expect, test, vi } from 'vitest'
import { loadSettings } from './settings'

test('falls back to defaults and logs when the file is corrupt', () => {
  using errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  const settings = loadSettings('corrupt.json')

  expect(settings).toEqual(DEFAULT_SETTINGS)
  expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('Failed to parse corrupt.json'),
  )
}) // `using` restores console.error here (Node 24+, or TS 5.2+ downlevel)
```

Without `using`, restore in the test: `onTestFinished(() => errorSpy.mockRestore())`, or call `vi.restoreAllMocks()` in `afterEach`.

## Unhandled Errors and Rejections

Vitest catches and reports unhandled rejections, uncaught exceptions (Node), and `error` events (browser). They fail the run even if every test passed. The usual cause is a promise that nothing awaits:

```ts
test('fetches user', async () => {
  fetchUser(123) // ❌ rejection has no handler → "Unhandled Rejection"
  await fetchUser(123) // ✅ or: await expect(fetchUser(123)).rejects.toThrow(...)
})
```

When the code under test is *supposed* to leave a rejection unhandled, listen for it explicitly and clean up the listener. A listener you register counts as handling, so Vitest does not report the error.

```ts
import { expect, test, vi } from 'vitest'

test('fire-and-forget rejection surfaces as unhandled', async ({ onTestFinished }) => {
  const listener = vi.fn()
  process.on('unhandledRejection', listener)
  onTestFinished(() => {
    process.off('unhandledRejection', listener)
  })

  startBackgroundSync({ failWith: new Error('offline') })

  await expect.poll(() => listener).toHaveBeenCalled()
})
```

## Config Escape Hatches (Use with Caution)

Both options hide real bugs. Fix the floating promise first.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Filter specific known errors. Returning false drops the error,
    // so it no longer affects the run result. Runs on the main thread (no test context).
    onUnhandledError(error) {
      if (error.name === 'KnownThirdPartyError') return false
    },
    // Reports unhandled errors but never fails the run. Avoid; it hides everything.
    // dangerouslyIgnoreUnhandledErrors: true,
  },
})
```

Prefer `onUnhandledError` with a narrow filter over `dangerouslyIgnoreUnhandledErrors`. Add a comment that names the upstream issue so the filter can be removed later.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `expect(fn()).toThrow()` | Error is thrown before `expect` runs | `expect(() => fn()).toThrow()` |
| `expect(promise).rejects.toThrow()` without `await` | Fails the test in 5.x (was a warning in 4.x) | `await expect(promise).rejects.toThrow()` |
| `toThrow('')` to mean "empty message" | In 5.x it matches any message | `toThrow(/^$/)` |
| `toThrow('id')` for a specific error | Substring also matches unrelated messages | Anchored RegExp, or class + message check |
| `try { await fn() } catch (e) { expect(e)... }` alone | Passes when nothing throws | `expect.assertions(n)`, `expect.unreachable()`, or `rejects` |
| Leaving a `console.error` spy unrestored | `restoreMocks` is off by default; later tests see a mock | `using`, `onTestFinished(() => spy.mockRestore())`, or `vi.restoreAllMocks()` |
| `dangerouslyIgnoreUnhandledErrors: true` to get green CI | Hides floating promises and real crashes | Await the promise; narrow `onUnhandledError` filter only if unavoidable |
| `expect(err).toBeTruthy()` then `(err as MyError).code` | No type narrowing, cast hides mistakes | `expect.assert(err instanceof MyError)` |

## Related References

- **Matchers overview**: [assertions.md](../core/assertions.md)
- **Async code, polling, timeouts**: [async-testing.md](../core/async-testing.md)
- **Spies and restoring them**: [mock-functions.md](../mocking/mock-functions.md)
- **Fake timers and rejections**: [timers-dates.md](../mocking/timers-dates.md)
- **Error snapshots**: [snapshots.md](snapshots.md)
- **"Unhandled Rejection" and other runtime errors**: [common-errors.md](../debugging/common-errors.md)
