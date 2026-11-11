# Test Data

## Table of Contents

1. [Principles](#principles)
2. [Factories with Overrides](#factories-with-overrides)
3. [Builders for Complex Objects](#builders-for-complex-objects)
4. [Deterministic Data: Time, Randomness, IDs](#deterministic-data-time-randomness-ids)
5. [Fixtures That Create Data](#fixtures-that-create-data)
6. [Unique Data per Test and per Worker](#unique-data-per-test-and-per-worker)
7. [Static Fixture Files](#static-fixture-files)
8. [Shared Mutable Module State](#shared-mutable-module-state)
9. [Table-Driven and Property-Based Data](#table-driven-and-property-based-data)

## Principles

- **Each test owns its data.** Create it inside the test or in a test-scoped fixture. Never let two tests mutate the same object.
- **Show only what matters.** Defaults fill in the rest, so the test shows only the fields that affect the behavior under test.
- **Make data deterministic.** No real clock, unseeded randomness, or ordering that depends on run order.
- **Use valid defaults.** A factory with no arguments returns a valid entity, and each test changes one thing to create the case it covers.

## Factories with Overrides

A factory is a function that returns a fresh, valid object and accepts partial overrides:

```ts
// test/factories.ts
import type { LineItem, Order, User } from '../src/types'

export function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    role: 'member',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

export function buildLineItem(overrides: Partial<LineItem> = {}): LineItem {
  return { sku: 'SKU-1', qty: 1, unitPrice: 10, ...overrides }
}

export function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    userId: 'user-1',
    status: 'pending',
    lines: [buildLineItem()],
    ...overrides,
  }
}
```

```ts
import { expect, test } from 'vitest'
import { canRefund, orderTotal } from '../src/orders'
import { buildLineItem, buildOrder, buildUser } from './factories'

test('admins can refund shipped orders', () => {
  const admin = buildUser({ role: 'admin' })
  const order = buildOrder({ status: 'shipped' })

  expect(canRefund(admin, order)).toBe(true)
})

test('total sums qty * unitPrice across lines', () => {
  const order = buildOrder({
    lines: [buildLineItem({ qty: 2, unitPrice: 5 }), buildLineItem({ qty: 1, unitPrice: 3 })],
  })

  expect(orderTotal(order)).toBe(13)
})
```

- Return a **new** object every call. Never return a shared constant that callers could mutate.
- Nested defaults (such as `lines`) must also be built inside the function, so arrays are not shared between calls.
- Keep factories next to the tests (`test/factories.ts`) and type them with the production types, so a schema change breaks them at compile time.

## Builders for Complex Objects

When objects have many valid combinations, a small builder reads better than deeply nested overrides:

```ts
import type { Cart } from '../src/types'

export class CartBuilder {
  private cart: Cart = { items: [], coupon: null, currency: 'USD' }

  withItem(sku: string, qty = 1, price = 10) {
    this.cart.items.push({ sku, qty, price })
    return this
  }

  withCoupon(code: string) {
    this.cart.coupon = code
    return this
  }

  build(): Cart {
    return structuredClone(this.cart)
  }
}

// new CartBuilder().withItem('A', 2).withCoupon('SAVE10').build()
```

Start with plain factory functions. Use a builder only when tests keep repeating the same multi-step setup.

## Deterministic Data: Time, Randomness, IDs

Hard-code timestamps in factories. For code that reads the clock, control the clock instead:

```ts
import { afterEach, expect, test, vi } from 'vitest'
import { buildUser } from './factories'
import { isTrialExpired } from '../src/billing'

afterEach(() => {
  vi.useRealTimers()
})

test('trial expires after 14 days', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T00:00:01Z'))

  const user = buildUser({ createdAt: new Date('2026-01-01T00:00:00Z') })

  expect(isTrialExpired(user)).toBe(true)
})
```

For randomness, **inject** the source (pass `random: () => number` or an ID generator) and give it a deterministic implementation in tests. If you can't inject it, stub it for the test:

```ts
import { expect, test, vi } from 'vitest'
import { pickWinner } from '../src/raffle'

test('pickWinner uses the random index', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  expect(pickWinner(['a', 'b', 'c', 'd'])).toBe('c')
})
```

```ts
import { expect, test, vi } from 'vitest'
import { createOrder } from '../src/orders'

test('uses the generated id', () => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
  expect(createOrder().id).toBe('00000000-0000-4000-8000-000000000001')
})
```

- Restore spies afterwards with `restoreMocks: true` in config, `onTestFinished(() => spy.mockRestore())`, or `using` ([async-testing.md](async-testing.md#auto-cleanup-with-using)).
- If you don't need the exact generated value, don't stub it. Assert the format with `expect.any(String)`, `expect.stringMatching(...)`, or `expect.schemaMatching(...)` ([assertions.md](assertions.md)).
- `sequence.seed` controls only **test order** when shuffling. It does not seed `Math.random` in your code.

## Fixtures That Create Data

Fixtures from `test.extend` create data only for the tests that ask for it, and clean it up afterwards:

```ts
// test/data-fixtures.ts
import { test as baseTest } from 'vitest'
import { createTestDb } from './db'
import { buildUser } from './factories'

export const test = baseTest
  .extend('db', { scope: 'file' }, async ({}, { onCleanup }) => {
    const db = await createTestDb()
    onCleanup(() => db.close())
    return db
  })
  .extend('userInput', () => buildUser())                  // plain data, overridable
  .extend('user', async ({ db, userInput }, { onCleanup }) => {
    const user = await db.users.insert(userInput)
    onCleanup(() => db.users.delete(user.id))
    return user
  })
```

```ts
import { describe, expect } from 'vitest'
import { test } from './test/data-fixtures'

describe('admin dashboard', () => {
  test.override('userInput', () => ({ ...buildAdmin() }))

  test('lists admin tools', async ({ db, user }) => {
    expect(await db.permissions.for(user.id)).toContain('manage-users')
  })
})

function buildAdmin() {
  return { id: 'admin-1', email: 'root@example.com', name: 'Root', role: 'admin' as const, createdAt: new Date(0) }
}
```

For a real database, rolling back a transaction per test (`test.aroundEach(async (runTest, { db }) => db.transaction(runTest))`) is usually faster and safer than deleting rows. See [integration-testing.md](../testing-patterns/integration-testing.md).

## Unique Data per Test and per Worker

Test files run in parallel workers. Any data that lives outside the worker process must be unique: database rows with unique keys, files, ports, queue names.

```ts
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { test as baseTest } from 'vitest'

export const test = baseTest
  .extend('dbName', { scope: 'worker' }, () => `app_test_${process.env.VITEST_POOL_ID}`)
  .extend('tmpDir', async ({}, { onCleanup }) => {
    const dir = await mkdtemp(join(tmpdir(), 'vitest-'))
    onCleanup(() => rm(dir, { recursive: true, force: true }))
    return dir
  })
  .extend('email', ({ task }) => `${task.name.replace(/\W+/g, '-')}-${crypto.randomUUID()}@example.com`)
```

> **Version note:** In 5.x `VITEST_POOL_ID` and `VITEST_WORKER_ID` are **1-based** (from `1` to the worker count). Update any code that uses them as a 0-based array index or offset.

## Static Fixture Files

JSON or text fixtures are fine for large, realistic payloads such as API responses or parser inputs.

```ts
import { expect, test } from 'vitest'
import { normalizeInvoice } from '../src/invoice'
import invoiceJson from './fixtures/invoice.json'

test('normalizes a real invoice payload', () => {
  const input = structuredClone(invoiceJson)       // the module is cached; don't mutate it
  expect(normalizeInvoice(input)).toMatchObject({ total: 5000, currency: 'USD' })
})
```

An imported module is evaluated once per test file. If one test mutates an imported fixture, the next test sees the change. Clone it, or read the file inside the test.

## Shared Mutable Module State

Each test **file** gets a fresh module graph by default (`isolate: true`). Tests **within** a file share module state, such as caches, singletons, and top-level `let` variables.

```ts
import { beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()                          // next dynamic import re-evaluates
})

test('cache starts empty', async () => {
  const { cache } = await import('../src/cache')
  expect(cache.size).toBe(0)
})
```

In order of preference:

1. Give the module an explicit reset or factory (`createCache()`) and use a fresh instance per test.
2. Reset state in `beforeEach` through a public API.
3. Use `vi.resetModules()` with dynamic `import()`. Static top-level imports are **not** re-evaluated, and the mock registry is not reset.

With `isolate: false`, module state also leaks **between files** in the same worker. Only disable isolation for files that keep no mutable module state ([performance.md](../infrastructure-ci-cd/performance.md)).

## Table-Driven and Property-Based Data

Use `test.for` with object rows for boundary values ([test-structure.md](test-structure.md#parameterized-tests-testfor-vs-testeach)). Cover the boundaries (0, max, max+1, empty, negative), not every value.

When a function has a large input space and properties that are easy to state (round-trips, sort stability, idempotence), use a property-based library such as [fast-check](https://fast-check.dev/). Keep the property small and pin a seed when you reproduce a failure.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| A shared `const user = {...}` mutated by tests | Order-dependent results | A factory returns a new object per call |
| Factories using `new Date()` / `Math.random()` | Non-deterministic failures | Fixed values, fake timers, injected RNG |
| Stubbing `randomUUID` when the value doesn't matter | Over-specified test | `expect.any(String)` / `stringMatching` |
| Huge literal objects copied into every test | Noise hides the field under test | Factory with defaults plus one override |
| Mutating an imported JSON fixture | Leaks into later tests in the file | `structuredClone` before use |
| Hard-coded DB names, ports, or temp paths | Parallel workers collide | `VITEST_POOL_ID`, `mkdtemp`, unique IDs |
| `VITEST_POOL_ID` used as a 0-based index | Off-by-one in 5.x | Treat it as 1-based |
| Seeding data in `beforeAll` that tests modify | Tests depend on each other | Per-test fixture or per-test transaction |
| Using `sequence.seed` to "seed" data | Seeds only test order | Inject or stub the RNG |

## Related References

- **Fixtures and scopes**: [fixtures-hooks.md](fixtures-hooks.md)
- **Parameterized tests**: [test-structure.md](test-structure.md)
- **Fake time and dates**: [timers-dates.md](../mocking/timers-dates.md)
- **Database tests**: [integration-testing.md](../testing-patterns/integration-testing.md)
- **Spies on Math/crypto**: [mock-functions.md](../mocking/mock-functions.md)
- **Order-dependent / leaking tests**: [flaky-tests.md](../debugging/flaky-tests.md)
