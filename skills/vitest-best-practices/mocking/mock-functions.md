# Mock Functions, Spies, and Classes

## Table of Contents

1. [vi.fn vs vi.spyOn](#vifn-vs-vispyon)
2. [Controlling Behavior](#controlling-behavior)
3. [Argument-Specific Behavior with vi.when](#argument-specific-behavior-with-viwhen)
4. [Asserting Calls](#asserting-calls)
5. [Inspecting mock State](#inspecting-mock-state)
6. [Clear vs Reset vs Restore](#clear-vs-reset-vs-restore)
7. [Typing Mocks](#typing-mocks)
8. [Mocking Classes](#mocking-classes)

## vi.fn vs vi.spyOn

- `vi.fn(impl?)` creates a standalone mock. Use it for callbacks and injected dependencies. Without `impl` it returns `undefined`.
- `vi.spyOn(obj, key)` replaces a method on an existing object and **keeps calling the original** until you give it an implementation. Use it to observe or override a method you don't construct yourself.

Both return the same `Mock` API.

```ts
import { expect, test, vi } from 'vitest'

test('passes the item to the callback', () => {
  const onItem = vi.fn()
  subscribe(onItem)
  publish({ id: 1 })
  expect(onItem).toHaveBeenCalledWith({ id: 1 })
})

test('spy keeps the original until overridden', () => {
  const cart = { getApples: () => 42 }
  const spy = vi.spyOn(cart, 'getApples')

  expect(cart.getApples()).toBe(42)
  spy.mockReturnValue(0)
  expect(cart.getApples()).toBe(0)
})
```

Spy on getters and setters with the third argument:

```ts
const nameSpy = vi.spyOn(user, 'name', 'get').mockReturnValue('Max')
expect(user.name).toBe('Max')
expect(nameSpy).toHaveBeenCalledTimes(1)
```

`vi.mockObject(obj)` deeply mocks an object's methods the same way `vi.mock` automocks module exports: methods return `undefined`, primitives are kept. With `{ spy: true }` it keeps the original implementations and replaces the methods with spies **in place** on the same object instead of copying it.

```ts
const api = vi.mockObject({ fetchUser: () => realFetch(), nested: { ping: () => 'pong' } })
api.fetchUser.mockReturnValue({ id: 1 })
expect(api.nested.ping()).toBeUndefined()
```

## Controlling Behavior

```ts
const fn = vi.fn()

fn.mockReturnValue(42)                    // every call
fn.mockReturnValueOnce(1)                 // next call only (queue)
fn.mockImplementation((a: number) => a + 1)
fn.mockImplementationOnce(() => 0)
fn.mockResolvedValue({ ok: true })        // Promise.resolve(value)
fn.mockResolvedValueOnce({ ok: false })
fn.mockRejectedValue(new Error('down'))   // Promise.reject(error)
fn.mockRejectedValueOnce(new Error('once'))
fn.mockThrow(new Error('sync'))           // throws synchronously
fn.mockThrowOnce(new Error('first only'))
fn.mockReturnThis()
fn.mockName('fetchUser')                  // shows in failure messages
```

"Once" values are consumed in order; when the queue is empty the mock falls back to the default implementation (`vi.fn(impl)` or `mockImplementation`):

```ts
const next = vi.fn(() => 'default')
  .mockReturnValueOnce('first')
  .mockReturnValueOnce('second')

// 'first', 'second', 'default', 'default'
```

Temporarily swap the implementation for a block. Await it when the callback is async:

```ts
const fn = vi.fn(() => 'original')

await fn.withImplementation(() => 'temp', async () => {
  expect(fn()).toBe('temp')
})
expect(fn()).toBe('original')
```

Restore a spy automatically at the end of a block with `using` (requires Explicit Resource Management support: TypeScript ≥ 5.2, Node.js ≥ 24):

```ts
test('silences console.log', () => {
  using spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  debug('message')
  expect(spy).toHaveBeenCalled()
}) // console.log restored here
```

## Argument-Specific Behavior with vi.when

New in 5.0. Replaces hand-written `if/else` inside `mockImplementation`. Arguments are matched with `toEqual` semantics and accept asymmetric matchers.

```ts
import { expect, test, vi } from 'vitest'

type FindById = (id: number) => Promise<User | undefined>

test('loads both users', async () => {
  const db = { findById: vi.fn<FindById>() }

  const w = vi.when(db.findById, { onUnmatched: 'throw' })
    .calledWith(1)
    .thenResolveOnce({ id: 1, name: 'Ella' })
    .calledWith(2)
    .thenResolveOnce({ id: 2, name: 'Gracie' })

  await loadDashboard(db)

  expect(w).toHaveBeenExhausted() // every behavior was used
})
```

Rules worth knowing:

- Actions: `thenReturn`, `thenThrow`, `thenResolve`, `thenReject`, plus `*Once` variants and a `{ times: n }` option.
- **Behaviors** (`calledWith`) match first-in-first-out: register specific matchers before broad ones like `expect.any(String)`.
- **Actions** on one behavior run last-in-first-out: register the indefinite fallback first, then finite overrides.
- Registering `calledWith` args that already match an existing behavior **merges** into it instead of creating a new one.
- Unmatched calls default to `onUnmatched: 'passthrough'` (original implementation, or `undefined` for a bare `vi.fn()`). Use `'throw'` to catch unexpected arguments, or a function for a custom fallback.
- `using w = vi.when(...)` restores the original implementation when the block exits.

## Asserting Calls

Prefer matchers over reading `mock.calls` directly; failures print a readable diff.

```ts
expect(fn).toHaveBeenCalled()
expect(fn).toHaveBeenCalledTimes(2)
expect(fn).toHaveBeenCalledWith('a', expect.any(Number))
expect(fn).toHaveBeenCalledExactlyOnceWith('a', 1)
expect(fn).toHaveBeenLastCalledWith('b', 2)
expect(fn).toHaveBeenNthCalledWith(1, 'a', 1)
expect(first).toHaveBeenCalledBefore(second)

expect(fn).toHaveReturnedWith(42)
expect(asyncFn).toHaveResolvedWith({ ok: true })
```

`toHaveBeenCalledOnceWith` does not exist; use `toHaveBeenCalledExactlyOnceWith`.

### Arguments Are Stored by Reference

Vitest stores call arguments by reference. If the code under test mutates an object after passing it, the assertion sees the mutated value:

```ts
const arg = { value: 0 }
fn(arg)
arg.value = 10

expect(fn).toHaveBeenCalledWith({ value: 10 }) // passes, not { value: 0 }
```

Capture a snapshot of the argument at call time when the original value matters:

```ts
const seen: unknown[] = []
const fn = vi.fn((arg: unknown) => {
  seen.push(structuredClone(arg))
})

run(fn)
expect(seen[0]).toEqual({ value: 0 })
```

## Inspecting mock State

| Property                    | Contents                                                                   |
| --------------------------- | -------------------------------------------------------------------------- |
| `mock.calls`                | Argument arrays, one per call                                              |
| `mock.lastCall`             | Arguments of the last call, or `undefined`                                 |
| `mock.results`              | `{ type: 'return' \| 'throw' \| 'incomplete', value }` per call            |
| `mock.settledResults`       | `{ type: 'fulfilled' \| 'rejected' \| 'incomplete', value }` per call      |
| `mock.instances`            | Object returned by `new`, or `this` for plain calls                        |
| `mock.contexts`             | `this` of each call                                                        |
| `mock.invocationCallOrder`  | Global call order numbers shared across all mocks                          |

A function returning a rejected promise still records `type: 'return'` in `mock.results`; use `settledResults` or `toHaveResolved*` for async outcomes.

## Clear vs Reset vs Restore

| Method                              | Call history | Implementation                                  | Original method (spyOn) |
| ----------------------------------- | ------------ | ----------------------------------------------- | ----------------------- |
| `mockClear()` / `vi.clearAllMocks()` | cleared      | kept (including queued "once" values)          | still spied             |
| `mockReset()` / `vi.resetAllMocks()` | cleared      | back to `vi.fn(impl)`'s `impl`, or `undefined`; once queue dropped | still spied (calls original) |
| `mockRestore()`                     | cleared      | reset                                           | **restored**            |
| `vi.restoreAllMocks()`              | **kept**     | **kept**                                        | restored for `vi.spyOn` spies only |

Config equivalents run before each test: `clearMocks`, `mockReset`, `restoreMocks`.

**Version note:** `clearMocks` defaults to `true` in 5.x. Call history no longer carries between tests, but implementations do. Calls recorded in `beforeAll`, at module top level, or in a setup file are wiped before the test that asserts on them.

```ts
const fn = vi.fn()

test('first', () => {
  fn()
  expect(fn).toHaveBeenCalledTimes(1)
})

test('second', () => {
  fn()
  expect(fn).toHaveBeenCalledTimes(1) // 2 in Vitest 4
})
```

Implementations set in one test (`mockReturnValue`, `mockImplementation`) still leak to the next. Either set them in `beforeEach`, or enable `mockReset`/`restoreMocks`:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    restoreMocks: true, // put vi.spyOn targets back before each test
  },
})
```

These config options act on all mocks at once and can interfere with `test.concurrent` tests that share mocks.

## Typing Mocks

Give `vi.fn` the function type so `mockReturnValue`/`mockResolvedValue` are checked:

```ts
const fetchUser = vi.fn<(id: string) => Promise<User>>()
fetchUser.mockResolvedValue({ id: '1', name: 'Ada' })
```

`vi.mocked` is a type-only helper for values that are mocks at runtime but typed as the original (for example exports replaced by `vi.mock`). It does not validate anything:

```ts
import { getUser } from './db'

vi.mock(import('./db'))

vi.mocked(getUser).mockReturnValue({ name: 'Alice' })
vi.mocked(getUser, { partial: true }).mockReturnValue({}) // allow Partial<T>
```

Use `vi.isMockFunction(fn)` to check and narrow at runtime.

## Mocking Classes

Pass a class to `vi.fn`. Instances keep the implementation's prototype chain and pass `instanceof` checks.

**Version note:** in 5.x, class mocks keep prototype methods. `vi.fn(Dog)`, `vi.spyOn(obj, 'Dog')`, and `.mockImplementation(class ...)` instances now see `Dog.prototype` methods (they were `undefined` in 4.x).

```ts
class Dog {
  constructor(public name: string) {}
  speak() {
    return 'bark!'
  }
}

const MockedDog = vi.fn(Dog)
const dog = new MockedDog('Cooper')

dog.speak()               // 'bark!' (original, not a spy)
dog instanceof Dog        // true
expect(MockedDog).toHaveBeenCalledWith('Cooper')
```

Prototype methods are **not** mocked by this. Pick one of three strategies:

```ts
// 1. Per-instance mocks: declare methods as class fields
const Dog = vi.fn(class {
  speak = vi.fn(() => 'loud bark!')
  feed = vi.fn()
})
const a = new Dog()
const b = new Dog()
a.speak()
expect(a.speak).toHaveBeenCalledTimes(1)
expect(b.speak).not.toHaveBeenCalled()

// 2. One shared mock for all instances: assign on the mock's prototype
MockedDog.prototype.speak = vi.fn(() => 'woof!')

// 3. One instance only: spy on that instance
vi.spyOn(dog, 'speak').mockReturnValue('meow!')
```

Rules:

- Use `class` or `function` implementations for constructors. An arrow function throws `<anonymous> is not a constructor` when called with `new`.
- Don't return an object from the constructor; the result is not an instance of the mock. `mockReturnValue` and `mockResolvedValue` throw when the mock is called with `new`. Use `mockImplementation(class { ... })` instead.
- `mockReset` re-points the mock's `prototype` back to the original implementation.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `jest.fn()` / `jest.spyOn()` | Not defined in Vitest | `vi.fn()` / `vi.spyOn()` |
| `toHaveBeenCalledOnceWith(...)` | Matcher does not exist | `toHaveBeenCalledExactlyOnceWith(...)` |
| `vi.spyOn` without restore | Spy leaks into later tests and files sharing the object | `restoreMocks: true`, `using`, or `mockRestore()` in `afterEach` |
| Assuming `clearMocks` resets return values | Only history is cleared; implementations leak | Set behavior in `beforeEach` or enable `mockReset` |
| Asserting on calls made in `beforeAll` | `clearMocks` (default on) wipes them before the test | Record and assert inside the test |
| `if/else` ladder in `mockImplementation` | Hard to read, unmatched args silently return `undefined` | `vi.when(...).calledWith(...)` with `onUnmatched: 'throw'` |
| `mockReturnValue({...})` for a class mock | Throws on `new`; instance is not `instanceof` the class | `mockImplementation(class { ... })` |
| Mutating an object after passing it to a mock | `toHaveBeenCalledWith` compares the mutated object | Clone in the implementation, or assert before mutation |
| Asserting call order of internal helpers | Breaks on refactor without behavior change | Assert outputs and boundary calls; see when-to-mock |

## Related References

- **Module mocks**: See [module-mocking.md](module-mocking.md) for `vi.mock`, `vi.hoisted`, partial mocks
- **When to mock at all**: See [when-to-mock.md](../architecture/when-to-mock.md)
- **Mock matchers and asymmetric matchers**: See [assertions.md](../core/assertions.md)
- **Cleanup and hooks**: See [fixtures-hooks.md](../core/fixtures-hooks.md)
- **Leaking state between tests**: See [flaky-tests.md](../debugging/flaky-tests.md)
