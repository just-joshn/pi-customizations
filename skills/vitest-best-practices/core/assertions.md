# Assertions

## Table of Contents

1. [Choosing an Equality Matcher](#choosing-an-equality-matcher)
2. [Partial Matching and Asymmetric Matchers](#partial-matching-and-asymmetric-matchers)
3. [Errors: toThrow](#errors-tothrow)
4. [Numbers and Floats](#numbers-and-floats)
5. [Type Narrowing with expect.assert](#type-narrowing-with-expectassert)
6. [Soft Assertions](#soft-assertions)
7. [Waiting: expect.poll, vi.waitFor, vi.waitUntil](#waiting-expectpoll-viwaitfor-viwaituntil)
8. [Guarding Against Assertions That Never Run](#guarding-against-assertions-that-never-run)
9. [Custom Matchers and Helpers](#custom-matchers-and-helpers)

## Choosing an Equality Matcher

| Matcher | Use for | Notes |
| --- | --- | --- |
| `toBe` | Primitives, same object reference | `Object.is`. Do not use for floats or for structural comparison |
| `toEqual` | Structural equality | Ignores `undefined` properties and sparse-array holes. A class instance equals a plain object with the same fields |
| `toStrictEqual` | Structural equality where types matter | Checks `undefined` keys, sparseness, and that object types match |
| `toMatchObject` | A subset of fields | Arrays must have the same length and order |

```ts
import { expect, test } from 'vitest'

class Money {
  constructor(public amount: number, public currency: string) {}
}

test('choose the matcher that states the contract', () => {
  expect(2 + 2).toBe(4)
  expect(new Money(5, 'USD')).toEqual({ amount: 5, currency: 'USD' })
  expect(new Money(5, 'USD')).not.toStrictEqual({ amount: 5, currency: 'USD' })
  expect({ a: undefined, b: 2 }).toEqual({ b: 2 })
  expect({ a: undefined, b: 2 }).not.toStrictEqual({ b: 2 })
})
```

`toEqual` also compares `Error` objects by `name`, `message`, `cause`, and `AggregateError.errors`. To check that something **throws**, use `toThrow`.

Other matchers you will use often:

```ts
import { expect, test } from 'vitest'

test('common matchers', () => {
  expect([1, 2, 3]).toContain(2)
  expect([{ id: 1 }]).toContainEqual({ id: 1 })
  expect('pineapple').toMatch(/apple/)
  expect([1, 2]).toHaveLength(2)
  expect({ user: { name: 'Ada' } }).toHaveProperty('user.name', 'Ada')
  expect('active').toBeOneOf(['active', 'pending'])
  expect(null).toBeNullable() // null or undefined
  expect(3).toSatisfy((n: number) => n % 2 === 1)
  expect(new Date()).toBeInstanceOf(Date)
  expect('x').toBeTypeOf('string')
})
```

Prefer a specific matcher to `toBeTruthy()`. `toBeTruthy` passes for `1`, `'0'`, `[]`, and `{}`, and the failure message tells you little.

## Partial Matching and Asymmetric Matchers

Asymmetric matchers go inside an expected value. They work with `toEqual`, `toStrictEqual`, `toMatchObject`, `toContainEqual`, `toHaveBeenCalledWith`, `toHaveReturnedWith`, and `toThrow`. Use them for generated values such as IDs and timestamps.

```ts
import { expect, test } from 'vitest'
import { createOrder } from './orders'

test('createOrder returns a pending order with generated fields', () => {
  const order = createOrder({ sku: 'A-1', qty: 2 })

  expect(order).toEqual({
    id: expect.stringMatching(/^ord_[a-z0-9]+$/),
    createdAt: expect.any(Date),
    status: 'pending',
    lines: expect.arrayContaining([expect.objectContaining({ sku: 'A-1' })]),
    total: expect.closeTo(19.98, 2),
    note: expect.toBeOneOf([expect.any(String), null]),
    meta: expect.anything(), // anything except null/undefined
  })
})
```

`toEqual` treats an `undefined` property as a missing one. So `{ note: undefined }` does **not** match `{ note: expect.toBeOneOf([expect.any(String), undefined]) }` under `toEqual` (checked in 5.1.0). Use `toStrictEqual` there, or apply `toBeOneOf` to the value directly.

`expect.not.objectContaining`, `expect.not.arrayContaining`, `expect.not.stringContaining`, and `expect.not.stringMatching` negate the matchers.

### Schema matching

If the project already has a Standard Schema validator (Zod, Valibot, ArkType), `expect.schemaMatching` checks the shape without listing every field:

```ts
import { expect, test, vi } from 'vitest'
import { z } from 'zod'
import { registerUser } from './register'

const User = z.object({ id: z.uuid(), email: z.email(), createdAt: z.date() }) // Zod 4 API

test('persists a valid user', () => {
  const repo = { save: vi.fn() }
  registerUser(repo, { email: 'a@b.com' })
  expect(repo.save).toHaveBeenCalledWith(expect.schemaMatching(User))
})
```

## Errors: toThrow

Wrap synchronous calls in a function. Otherwise the error is thrown before `expect` runs. For promises, use `await expect(promise).rejects.toThrow(...)` ([async-testing.md](async-testing.md)).

```ts
import { expect, test } from 'vitest'
import { getStock, StockError } from './stock'

test('getStock rejects unknown items', () => {
  expect(() => getStock('pineapple')).toThrow('not in stock')        // substring
  expect(() => getStock('pineapple')).toThrow(/^Pineapple is not in stock$/)
  expect(() => getStock('pineapple')).toThrow(StockError)            // class
  expect(() => getStock('pineapple')).toThrow(expect.objectContaining({ code: 'E_STOCK' }))
})
```

- A string argument matches a **substring** of the message. Use a RegExp for an exact match.
- Use `toThrow`. `toThrowError` is a deprecated alias.
- Bare `toThrow()` passes for any error, including a `TypeError` from a typo. Always pass a message, class, or pattern.

> **Version note:** In 5.x `toThrow('')` matches **any** message, because every string contains the empty string. In 4.x it matched only an empty message. Use `toThrow(/^$/)` to assert an empty message.

## Numbers and Floats

```ts
import { expect, test } from 'vitest'

test('floats', () => {
  expect(0.1 + 0.2).not.toBe(0.3)
  expect(0.1 + 0.2).toBeCloseTo(0.3)      // default precision: 2 decimal digits
  expect(0.1 + 0.2).toBeCloseTo(0.3, 10)
  expect({ sum: 0.1 + 0.2 }).toEqual({ sum: expect.closeTo(0.3, 5) })
  expect(10).toBeGreaterThanOrEqual(10)
  expect(Number('x')).toBeNaN()
})
```

## Type Narrowing with expect.assert

`expect(x).toBeDefined()` fails at runtime but does **not** narrow the TypeScript type. `expect.assert` is an assertion function, so it fails and narrows at once. Use it instead of `!` or `as`.

```ts
import { expect, test } from 'vitest'

test('reads a cached user', () => {
  const cache = new Map<string, { name: string }>([['alice', { name: 'Alice' }]])
  const user = cache.get('alice')     // { name: string } | undefined

  expect.assert(user)                 // throws if undefined; narrows below
  expect(user.name).toBe('Alice')
})

test('narrows unions and errors', () => {
  const err: unknown = new RangeError('bad')
  expect.assert(err instanceof RangeError)
  expect(err.message).toBe('bad')

  expect.assert.isDefined(process.env.HOME)
})
```

## Soft Assertions

`expect.soft` records a failure and keeps the test running, so a single run reports every mismatch. A failing regular `expect` stops the test and reports all failures so far. Use `expect.soft` only inside a test body.

```ts
import { expect, test } from 'vitest'
import { loadConfig } from './config'

test('default config values', () => {
  const config = loadConfig({})
  expect.soft(config.port).toBe(3000)
  expect.soft(config.host).toBe('localhost')
  expect.soft(config.retries).toBe(3)
})
```

## Waiting: expect.poll, vi.waitFor, vi.waitUntil

Do not wait with `setTimeout` sleeps. Use a helper that retries until a condition holds. By default each helper times out after 1000 ms and retries every 50 ms. All three accept a `message` that names the wait in the error. All three advance fake timers automatically.

| | `expect.poll(fn).matcher()` | `vi.waitFor(fn)` | `vi.waitUntil(fn)` |
| --- | --- | --- | --- |
| Use when | The wait is an assertion | The work throws until it is ready | A lookup is falsy until it is ready |
| Thrown error | Retries | Retries | Fails immediately |
| Resolves with | The assertion | The callback's return value | The callback's truthy return value |

```ts
import { expect, test, vi } from 'vitest'
import { connect, createServer, jobs, queue, startJob } from './app'

test('waiting helpers', async () => {
  createServer()
  await expect.poll(() => queue.size(), { timeout: 2000, message: 'queue drained' }).toBe(0)

  const client = await vi.waitFor(() => connect(), { timeout: 5000, interval: 100 })
  expect(client.connected).toBe(true)

  startJob('build-42')
  const result = await vi.waitUntil(() => jobs.get('build-42'), { timeout: 5000 })
  expect(result.status).toBe('ok')
})
```

- Always `await` `expect.poll`. It does not support snapshot matchers, `.resolves`/`.rejects`, or `toThrow`. For those, wait with `vi.waitFor` first and then assert.
- **Version note:** In 5.x `expect.poll` **fails** when the timeout passes, even if a late attempt would have passed. Its callback receives `{ signal }`, which aborts at the timeout. Pass it to `fetch` and similar APIs.
- Defaults can be set with the `expect.poll.interval` and `expect.poll.timeout` config options.

## Guarding Against Assertions That Never Run

If an assertion sits inside a callback, loop, or branch, the test can pass without running it. Guard against that:

```ts
import { expect, test } from 'vitest'
import { fetchItems, onSelect, select } from './db-events'

test('select notifies subscribers', async () => {
  expect.assertions(1)          // exactly one assertion must run
  onSelect((row) => {
    expect(row).toMatchObject({ id: 3 })
  })
  await select(3)
})

test('every item has an id', async () => {
  expect.hasAssertions()        // at least one; an empty list fails the test
  for (const item of await fetchItems()) expect(item.id).toBeDefined()
})
```

To require at least one assertion in every test, set `expect: { requireAssertions: true }` in config. In concurrent tests, call `assertions`/`hasAssertions` on the **context** `expect`.

Use `expect.unreachable(msg)` (or `expect.fail(msg)`) to mark code that must not run, for example after a call that should have thrown inside `try`.

## Custom Matchers and Helpers

### Assertion helpers (simplest)

Wrap a group of `expect` calls with `vi.defineHelper`. A failure then points at the line that called the helper, not at the line inside it:

```ts
import { expect, vi } from 'vitest'

export const expectValidUser = vi.defineHelper((user: { id?: string; email?: string }) => {
  expect(user).toHaveProperty('id')
  expect(user.email).toMatch(/@/)
})
```

### expect.extend

Register custom matchers in a [setupFiles](configuration.md) entry so every test file has them. Calling `expect.extend` also creates an asymmetric version (`expect.toBeWithinRange(...)`).

```ts
// test/matchers.ts (listed in setupFiles)
import { expect } from 'vitest'

expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const { isNot } = this
    return {
      pass: received >= floor && received <= ceiling, // don't invert for isNot; Vitest does it
      message: () => `expected ${received}${isNot ? ' not' : ''} to be within ${floor}-${ceiling}`,
      actual: received,
    }
  },
})
```

```ts
// vitest.d.ts (must be included by tsconfig)
import 'vitest'

declare module 'vitest' {
  interface Matchers<R, T> {
    toBeWithinRange: (floor: number, ceiling: number) => R
  }
}
```

> **Version note:** In 5.x `Matchers` takes `<R, T>`. `R` is the return type: `void` when synchronous, and `Promise<void>` through `.resolves`, `.rejects`, or `expect.poll`. `T` is the received type. Vitest **no longer reads `jest.Matchers`**. Declare an async matcher's return type as `Promise<void>` and await it.

Inside a matcher, `this` provides `isNot`, `promise`, `equals`, `customTesters`, `utils`, `currentTestName`, `testPath`, and `task`. For `toEqual`-like comparisons, call `this.equals(a, b, [...this.customTesters, this.utils.iterableEquality])`.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `expect(obj).toBe({ ... })` | Reference comparison always fails | `toEqual` / `toStrictEqual` |
| `toEqual` when `undefined` fields or class type matter | Passes despite extra `undefined` keys or the wrong class | `toStrictEqual` |
| `expect(fn()).toThrow()` | Throws before `expect` runs | `expect(() => fn()).toThrow('msg')` |
| Bare `toThrow()` / `toThrow('')` | Passes for any error, including typos | Assert a message, RegExp, or class |
| `expect(0.1 + 0.2).toBe(0.3)` | Float rounding | `toBeCloseTo` / `expect.closeTo` |
| `toBeTruthy()` as the main check | Weak contract and vague failure | Specific matcher |
| `expect(x).toBeDefined(); x!.foo` | No narrowing, so the code needs `!` | `expect.assert(x)` |
| `await new Promise(r => setTimeout(r, 500))` before asserting | Slow and flaky | `expect.poll` / `vi.waitFor` |
| Unawaited `expect.poll(...)` | Fails the test in 5.x | `await expect.poll(...)` |
| Assertions only inside callbacks | Test passes if the callback never runs | `expect.assertions(n)` / `hasAssertions` |
| Huge `toEqual` with hand-copied generated values | Brittle | Asymmetric matchers or `schemaMatching` |
| Augmenting `jest.Matchers` | Ignored by Vitest 5 | Augment `Matchers<R, T>` in module `vitest` |

## Related References

- **Async assertions (resolves/rejects)**: [async-testing.md](async-testing.md)
- **Error-path testing in depth**: [error-testing.md](../testing-patterns/error-testing.md)
- **Mock call matchers (toHaveBeenCalledWith, ...)**: [mock-functions.md](../mocking/mock-functions.md)
- **Snapshots**: [snapshots.md](../testing-patterns/snapshots.md)
- **Type-level assertions (expectTypeOf)**: [type-testing.md](../testing-patterns/type-testing.md)
- **Registering matchers in setup files**: [configuration.md](configuration.md)
