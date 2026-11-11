# Module Mocking

## Table of Contents

1. [Choosing an Approach](#choosing-an-approach)
2. [vi.mock and Hoisting](#vimock-and-hoisting)
3. [Factories and Partial Mocks](#factories-and-partial-mocks)
4. [Sharing Mocks with vi.hoisted](#sharing-mocks-with-vihoisted)
5. [Automocking, spy: true, and __mocks__](#automocking-spy-true-and-__mocks__)
6. [Spying on a Single Export](#spying-on-a-single-export)
7. [Per-Test Module Mocks: vi.doMock and resetModules](#per-test-module-mocks-vidomock-and-resetmodules)
8. [Pitfalls](#pitfalls)

## Choosing an Approach

| Need | Use |
| --- | --- |
| Replace every export with your own values | `vi.mock(import('./x'), () => ({ ... }))` |
| Replace some exports, keep the rest real | factory + `importOriginal()` |
| Keep real behavior, assert calls | `vi.mock(import('./x'), { spy: true })` |
| Every export returns `undefined` | `vi.mock(import('./x'))` (automock) |
| Reusable hand-written fake | `__mocks__/` file + `vi.mock(path)` |
| Different module mock per test | `vi.doMock` + dynamic `import()` |
| Override one export for one test | `vi.spyOn(namespace, 'fn')` (not in Browser Mode) |
| Return values per test | factory with `vi.fn()`, then `vi.mocked(fn).mockReturnValue(...)` in the test |

## vi.mock and Hoisting

Vitest rewrites test files that contain `vi.mock`: the call moves to the top of the file and static imports become dynamic imports evaluated after it. So the mock is registered before any import, regardless of where you write it.

**Version note:** In 5.x, `vi.mock`, `vi.unmock`, and `vi.hoisted` must be at the module **top level**. Calling them inside a function, block, `describe`, or `test` now throws (it was a warning in 4.x). `vi.doMock`/`vi.doUnmock` are not hoisted and can go anywhere.

```ts
import { expect, test, vi } from 'vitest'
import { getUser } from './db.js'

vi.mock(import('./db.js'), () => ({
  getUser: vi.fn(),
}))

test('uses the mocked export', () => {
  vi.mocked(getUser).mockReturnValue({ name: 'Alice' })

  expect(getUser(1).name).toBe('Alice')
  expect(getUser).toHaveBeenCalledWith(1)
})
```

Prefer `vi.mock(import('./db.js'), ...)` over `vi.mock('./db.js', ...)`. The `import()` form types `importOriginal`, type-checks the factory's return value against the real module, and is updated when an IDE moves the file. With `tsconfig` `paths` aliases, use relative paths inside `import()` so TypeScript can resolve the types.

Requirements:

- `vi` must be imported from `vitest` (or `globals: true`). Vitest finds `vi.mock` statically; a `vi` re-exported from a helper file is not hoisted.
- Only `import` is intercepted. `require()` is not mocked.
- Modules already imported by a setup file are cached and won't be mocked in the test file. Call `vi.resetModules()` inside `vi.hoisted` if needed.
- Put `vi.mock` in a `setupFiles` entry to apply it to every test file.
- The factory runs once; its result is cached until `vi.unmock`/`vi.doUnmock`.

## Factories and Partial Mocks

The factory cannot reference variables from the surrounding file, because it runs before them. Missing exports throw a helpful error when accessed. Default exports need a `default` key:

```ts
vi.mock(import('./logger.js'), () => ({
  default: { info: vi.fn(), error: vi.fn() },
  createLogger: vi.fn(),
}))
```

Keep most of the module real and override a few exports with `importOriginal` (async, must be awaited):

```ts
vi.mock(import('./pricing.js'), async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    fetchRates: vi.fn(async () => ({ USD: 1, EUR: 0.9 })),
  }
})
```

Wrap an original to keep its behavior but track calls:

```ts
vi.mock(import('./math.js'), async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, add: vi.fn(mod.add) }
})
```

`vi.importActual(path)` returns the real module from anywhere (including inside a string-path factory). `vi.importMock(path)` returns an automocked copy.

## Sharing Mocks with vi.hoisted

To configure a factory's mocks from the test body, create them in `vi.hoisted`, which is hoisted ahead of `vi.mock`:

```ts
import { beforeEach, expect, test, vi } from 'vitest'
import { sendWelcome } from './onboarding.js'

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}))

vi.mock(import('./email.js'), () => ({
  sendEmail: mocks.sendEmail,
}))

beforeEach(() => {
  mocks.sendEmail.mockResolvedValue({ ok: true })
})

test('sends a welcome email', async () => {
  await sendWelcome('ada@example.com')
  expect(mocks.sendEmail).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'ada@example.com' }),
  )
})
```

`vi.hoisted` cannot use static imports from the file (they aren't initialized yet: `Cannot access '__vi_import_0__' before initialization`). Use `await import()` inside it if you must.

## Automocking, spy: true, and __mocks__

`vi.mock(path)` with no factory:

1. Uses `__mocks__/<name>` if it exists:
   - packages (`axios`, `@company/utils`): `__mocks__/` in the project root
   - local files: `__mocks__/` next to the file (`src/__mocks__/increment.js` for `src/increment.js`)
2. Otherwise automocks the real module: methods return `undefined`, arrays are emptied, primitives kept, getters return `undefined`, objects and class instances/prototypes deep-cloned.

Modules are **not** mocked unless `vi.mock` is called, even if a `__mocks__` file exists.

`{ spy: true }` automocks but keeps every implementation, so you can assert calls without changing behavior:

```ts
import { expect, test, vi } from 'vitest'
import { Answer } from './answer.js'

vi.mock(import('./answer.js'), { spy: true })

test('tracks calls on instances it never sees', () => {
  new Answer(42).value()
  new Answer(0).value()
  expect(Answer.prototype.value).toHaveBeenCalledTimes(2)
})
```

With `spy: true`, Node built-ins and externalized dependencies are spied **in place**, so other code in the worker sees the spies too (for example `vi.mock(import('node:events'), { spy: true })` spies on every emitter).

Automocked modules give `undefined` returns; set values per test:

```ts
import * as example from './example.js'

vi.mock(import('./example.js'))

test('override an automocked export', () => {
  vi.mocked(example.add).mockReturnValue(10)
  expect(example.add(1, 1)).toBe(10)
})
```

## Spying on a Single Export

In Node-based environments (node, jsdom, happy-dom) you can spy on a namespace import:

```ts
import * as exampleObject from './example.js'

vi.spyOn(exampleObject, 'answer').mockReturnValue(0)
expect(exampleObject.answer()).toBe(0)
```

Other modules that import `answer` by name see the spy, as long as they call it after `vi.spyOn`. This does not work in Browser Mode (module namespaces are sealed); use `vi.mock(path, { spy: true })` there and `vi.mocked(...)` to override.

## Per-Test Module Mocks: vi.doMock and resetModules

`vi.doMock` is not hoisted, can reference local variables, and affects only the **next dynamic** `import()`. Already-imported bindings are unchanged.

```ts
import { beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules() // clear the module cache so the next import re-evaluates
})

test('feature flag on', async () => {
  vi.doMock(import('./flags.js'), () => ({ isEnabled: () => true }))
  const { render } = await import('./banner.js')
  expect(render()).toContain('New!')
})

test('feature flag off', async () => {
  vi.doMock(import('./flags.js'), () => ({ isEnabled: () => false }))
  const { render } = await import('./banner.js')
  expect(render()).toBe('')
})
```

- `vi.resetModules()` clears the module cache, not the mock registry. Use `vi.doUnmock` to drop a mock.
- `vi.doMock` returns a disposable: `using _m = vi.doMock(...)` unmocks when the block exits.
- `vi.mock` in a test file applies to that file's module graph, not to other test files. To mock a module for every file, call `vi.mock` in a `setupFiles` entry.

## Pitfalls

### Calls inside the same module are not mocked

```ts
// foobar.ts
export function foo() { return 'foo' }
export function foobar() { return `${foo()}bar` }
```

Mocking or spying on `foo` from a test does not affect `foobar`, which calls the local binding directly. This is intentional. Move `foo` to its own module or inject it.

### Factory references a file-level variable

```ts
const user = { name: 'Ada' }
vi.mock(import('./db.js'), () => ({ getUser: () => user })) // user is not initialized yet
```

Create the value inside the factory, use `vi.hoisted`, or use `vi.doMock`.

### Mock seems ignored

Check, in order: path resolves to the same module the code imports (aliases are supported); `vi` imported from `vitest`; the module isn't imported via `require`; it wasn't first loaded by a setup file; `vi.mock` is at top level.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `vi.mock` inside `describe`/`test`/`beforeEach` | Throws in 5.x; it never ran there anyway | Top-level `vi.mock`, or `vi.doMock` + dynamic import |
| `vi.mock('./x')` string path in TS | No type checking of factory or `importOriginal` | `vi.mock(import('./x'), ...)` |
| Factory returns plain functions | Calls can't be asserted or reconfigured | Return `vi.fn()` / `vi.fn(original)` |
| Full mock when only one export matters | Hides real behavior, large factories drift from the real module | `importOriginal` partial mock or `{ spy: true }` |
| Expecting `__mocks__` to apply automatically | Not mocked without a `vi.mock` call | Call `vi.mock(path)`, or put it in `setupFiles` |
| Mocking a sibling function in the same file | Internal calls bypass the mock | Split the module or inject the dependency |
| `vi.doMock` then reading a static import | Static import already evaluated | Dynamic `await import()` after `vi.doMock` |
| `vi.spyOn` on module exports in Browser Mode | Namespaces are sealed | `vi.mock(path, { spy: true })` |
| Mocking the module under test | Test checks the mock, not the code | Mock its dependencies only |

## Related References

- **Mock function API, vi.mocked, class mocks**: See [mock-functions.md](mock-functions.md)
- **Should this be mocked**: See [when-to-mock.md](../architecture/when-to-mock.md)
- **fs via `__mocks__` + memfs**: See [file-system.md](file-system.md)
- **"Mock not applied" and hoisting errors**: See [common-errors.md](../debugging/common-errors.md)
- **Browser Mode module mocking limits**: See [browser-mode.md](../testing-patterns/browser-mode.md)
- **Jest `jest.mock` differences**: See [migration.md](../architecture/migration.md)
