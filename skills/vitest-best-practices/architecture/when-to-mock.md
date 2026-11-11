# When to Mock

## Table of Contents

1. [Decision Guide](#decision-guide)
2. [Mock at the Boundaries](#mock-at-the-boundaries)
3. [Don't Mock What You Own](#dont-mock-what-you-own)
4. [Spy vs Replace vs Fake](#spy-vs-replace-vs-fake)
5. [Over-Mocking Smells](#over-mocking-smells)
6. [Contract Drift](#contract-drift)
7. [Keeping Mocks Isolated](#keeping-mocks-isolated)

## Decision Guide

Default to the real dependency. Reach for a mock only when the real thing is **slow, nondeterministic, or has side effects you can't control** in a test.

```
Is it the code under test?
└─ Yes → never mock it.

Is the dependency fast, deterministic, and side-effect free?
(pure functions, in-memory data structures, your own domain logic)
└─ Yes → use the real thing.

Is it a process boundary?
├─ HTTP / WebSocket / GraphQL     → MSW (network-requests.md)
├─ Time, timers, Date, Temporal   → vi.useFakeTimers / vi.setSystemTime (timers-dates.md)
├─ Randomness, UUIDs              → inject a generator, or vi.spyOn(Math, 'random')
├─ File system                    → memfs or a temp dir (file-system.md)
├─ process.env, globals, window   → vi.stubEnv / vi.stubGlobal (globals-env.md)
├─ Database                       → real test DB if feasible (integration-testing.md), else a fake repository
└─ Third-party SDK (payments, email, analytics) → mock your thin adapter around it

Do you only need to observe a call, not change it?
└─ Yes → vi.spyOn (keeps the original) or vi.mock(path, { spy: true }).
```

## Mock at the Boundaries

Replace things at the edge of your system, then let everything inside run for real. The test then covers your wiring, parsing, and error handling.

```ts
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'
import { server } from '../tests/msw'
import { checkout } from './checkout'

// Real: cart math, validation, request building, response parsing.
// Mocked: only the payment provider's HTTP API.
test('charges the cart total including tax', async () => {
  let charged: unknown
  server.use(
    http.post('https://payments.example.com/charges', async ({ request }) => {
      charged = await request.json()
      return HttpResponse.json({ id: 'ch_1', status: 'succeeded' })
    }),
  )

  const result = await checkout({ items: [{ price: 1000, qty: 2 }], taxRate: 0.1 })

  expect(result).toEqual({ ok: true, chargeId: 'ch_1' })
  expect(charged).toMatchObject({ amount: 2200 })
})
```

Wrap third-party SDKs in a small adapter you own (`payments.charge(amount)`), and mock the adapter's module in unit tests of callers. Test the adapter itself against MSW or a sandbox.

## Don't Mock What You Own

Mocking your own internal modules tests that the code calls them, not that it works. If `OrderService` uses `calculateTotal` (a pure function in your codebase), let it run:

```ts
// ❌ Re-states the implementation; passes even if calculateTotal is wrong
vi.mock(import('./pricing'), () => ({ calculateTotal: vi.fn(() => 2200) }))

test('places an order', async () => {
  await placeOrder(cart)
  expect(calculateTotal).toHaveBeenCalledWith(cart)
})
```

```ts
// ✅ Mock only the boundary (the repository), assert the outcome
test('places an order with the computed total', async () => {
  const orders = createInMemoryOrderRepo()
  const order = await placeOrder(cart, { orders })

  expect(order.total).toBe(2200)
  expect(await orders.findById(order.id)).toMatchObject({ total: 2200 })
})
```

Also, mocking a function from the same module as its caller has no effect. Internal calls use the local binding. If you need to swap it, that's a sign it belongs behind a seam (separate module or injected parameter).

## Spy vs Replace vs Fake

| Tool | Behavior | Use for |
| --- | --- | --- |
| `vi.spyOn(obj, 'm')` | Calls the original, records calls | Observing a call that is part of the contract (e.g. a logger warning) |
| `vi.mock(path, { spy: true })` | All exports spied, originals kept | Same, for module exports and in Browser Mode |
| `vi.fn()` / `mockReturnValue` / `vi.when` | Replaces behavior | Driving a dependency into a specific state (error, empty, edge case) |
| Full `vi.mock` factory | Replaces a module | Boundaries you can't run (SDKs, native bindings) |
| Hand-written fake (in-memory repo, fake clock) | Working lightweight implementation | Stateful dependencies used across many tests |

Fakes often beat mocks for stateful dependencies: tests assert on resulting state instead of call sequences, and one fake is reused everywhere.

```ts
function createInMemoryOrderRepo() {
  const rows = new Map<string, Order>()
  return {
    async save(order: Order) {
      rows.set(order.id, order)
    },
    async findById(id: string) {
      return rows.get(id)
    },
  }
}
```

## Over-Mocking Smells

A test is probably coupled to implementation if:

- Every import of the module under test is mocked.
- It asserts that internal helpers were called, in a particular order, with particular arguments, and asserts nothing about the result.
- Renaming or inlining a private helper breaks it while behavior stays the same.
- The mock setup is longer than the code under test.
- The mock returns exactly what the assertion checks (`mockReturnValue(x)` → `expect(result).toBe(x)` with nothing in between).
- `toHaveBeenCalledTimes` is used for things the user can't observe.

Ask: "If I changed the internals but the function still returned the right result, would this test break?" If yes, rewrite it to assert outputs, resulting state, or calls at a real boundary.

Call assertions are right when the call **is** the behavior: an email was sent, an analytics event was emitted, a callback prop was invoked.

```ts
test('notifies the parent when saved', async () => {
  const onSave = vi.fn()
  await submitForm({ name: 'Ada' }, { onSave })
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ name: 'Ada' })
})
```

## Contract Drift

A mock encodes an assumption about the real dependency. When the real API changes, the mock keeps passing. Reduce drift:

- **Type the mock.** Use `vi.mock(import('./x'), factory)` so the factory's return value is checked against the real module, and `vi.fn<typeof realFn>()` so `mockResolvedValue` must match the real return type. Run `tsc --noEmit`; Vitest doesn't type-check.
- **Partial over full.** `importOriginal()` keeps unmocked exports real, so new or renamed exports aren't silently missing.
- **Mock at the network, not the client.** MSW handlers respond to real requests, so a changed URL or method fails the test (with an error on unhandled requests).
- **Share fixtures.** Build mocked responses from the same factories/types the real code uses, not ad-hoc literals in each test.
- **Keep a few real integration tests** at each mocked boundary (real DB, provider sandbox, or E2E) so drift shows up somewhere.

```ts
import type { getUser } from './db'

const fetchUser = vi.fn<typeof getUser>()
fetchUser.mockResolvedValue({ id: '1', name: 'Ada' }) // type error if User changes
```

## Keeping Mocks Isolated

Mocks that leak between tests cause order-dependent failures. In 5.x, `clearMocks` is on by default (history cleared before each test), but implementations, spies, stubs, and fake timers are not reset by default. A safe baseline config:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    restoreMocks: true,   // undo vi.spyOn
    unstubGlobals: true,  // undo vi.stubGlobal
    unstubEnvs: true,     // undo vi.stubEnv
  },
})
```

Then: set mock behavior in `beforeEach` or inside the test, pair `vi.useFakeTimers()` with `vi.useRealTimers()`, and reset MSW handlers after each test. `vi.mock` is file-scoped. Put it in a setup file only when every test file needs it.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Mocking the module under test | Tests the mock | Mock its dependencies only |
| Mocking pure internal helpers | Tests wiring, not behavior; breaks on refactor | Use the real function |
| Asserting call order of internals | Coupled to implementation | Assert outputs, state, or boundary calls |
| `vi.mock` of the HTTP client | Skips request/response code; drifts from API | MSW |
| Untyped `vi.fn()` standing in for a typed API | Drift goes unnoticed | `vi.fn<typeof real>()`, `vi.mock(import(...))`, run `tsc` |
| Mocking everything "for speed" | Little confidence gained | Real deps when fast and deterministic |
| Mocking `Date.now` / `Math.random` ad hoc in many tests | Inconsistent, leaky | Fake timers; inject a clock/RNG |
| Only mocked tests at a boundary | Real integration never verified | A few integration/E2E tests per boundary |

## Related References

- **Unit vs integration vs browser vs E2E**: See [test-architecture.md](test-architecture.md)
- **Mock functions and spies**: See [mock-functions.md](../mocking/mock-functions.md)
- **Module mocks and partial mocks**: See [module-mocking.md](../mocking/module-mocking.md)
- **HTTP boundaries**: See [network-requests.md](../mocking/network-requests.md)
- **Time and randomness**: See [timers-dates.md](../mocking/timers-dates.md)
- **File system**: See [file-system.md](../mocking/file-system.md)
- **Env and globals**: See [globals-env.md](../mocking/globals-env.md)
- **Real databases**: See [integration-testing.md](../testing-patterns/integration-testing.md)
