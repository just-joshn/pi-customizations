# Fixtures & Hooks

## Table of Contents

1. [Choosing a Setup Mechanism](#choosing-a-setup-mechanism)
2. [Lifecycle Hooks](#lifecycle-hooks)
3. [onTestFinished and onTestFailed](#ontestfinished-and-ontestfailed)
4. [aroundEach and aroundAll](#aroundeach-and-aroundall)
5. [Test Context](#test-context)
6. [Fixtures with test.extend](#fixtures-with-testextend)
7. [Fixture Scopes](#fixture-scopes)
8. [Overriding Fixtures with test.override](#overriding-fixtures-with-testoverride)
9. [setupFiles vs globalSetup, provide/inject](#setupfiles-vs-globalsetup-provideinject)
10. [Execution Order](#execution-order)

## Choosing a Setup Mechanism

| Need | Use |
| --- | --- |
| A fresh value per test, with cleanup, used by only some tests | `test.extend` fixture (lazy, typed) |
| An expensive resource shared by a file or worker | Fixture with `scope: 'file'` / `'worker'` |
| A side effect for every test in a suite (reset a store) | `beforeEach` with a returned cleanup |
| Running the test *inside* a context (transaction, AsyncLocalStorage, span) | `aroundEach` / `aroundAll` |
| Cleanup registered from a helper or mid-test | `onTestFinished` |
| Polyfills, `expect.extend`, global `afterEach` for every file | `setupFiles` |
| Start a server or container once for the whole run | `globalSetup` + `provide`/`inject` |

## Lifecycle Hooks

A hook applies to the file when called at the top level, or to the enclosing `describe`. `beforeEach`/`beforeAll` may **return a cleanup function**. That function runs after all `afterEach`/`afterAll` hooks.

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createServer } from './server'
import { store } from './store'

let server: Awaited<ReturnType<typeof createServer>>

beforeAll(async () => {
  server = await createServer({ port: 0 })
  return async () => server.close()          // cleanup paired with setup
})

describe('cart', () => {
  beforeEach(() => {
    store.reset({ items: [] })
    return () => store.reset()
  })

  test('starts empty', () => {
    expect(store.get().items).toEqual([])
  })
})

afterAll(() => { /* runs before the beforeAll cleanup above */ })
```

- Hooks may be `async`. Their timeout is `hookTimeout` (10 s in Node), and you can pass a timeout as the last argument.
- `afterEach` hooks run in reverse registration order by default (`sequence.hooks: 'stack'`). The other values are `'list'` and `'parallel'`.
- If a `beforeAll` throws, the suite is reported as failed and its tests are skipped. Avoid `beforeAll` for mutable data that tests change.
- Hooks do not run when Vitest runs as a type checker.

## onTestFinished and onTestFailed

Register these during a test. `onTestFinished` always runs, pass or fail, after the `afterEach` hooks, in reverse order. It keeps cleanup next to the code that created the resource and works inside reusable helpers:

```ts
import { expect, onTestFailed, onTestFinished, test, vi } from 'vitest'
import { connectDb } from './db'
import * as api from './api'

function getTestDb() {
  const db = connectDb(':memory:')
  onTestFinished(() => db.close())
  return db
}

test('query returns no users', async () => {
  const db = getTestDb()
  const spy = vi.spyOn(api, 'track')
  onTestFinished(() => spy.mockRestore())    // restored even if an assertion fails
  onTestFailed(({ task }) => console.log(db.dump(), task.result?.errors))

  expect(await db.query('SELECT * FROM users')).toEqual([])
})
```

Both throw if called outside a test body. In concurrent tests, use the context versions: `test.concurrent('x', ({ onTestFinished }) => ...)`.

## aroundEach and aroundAll

Use these when the test must run **inside** something, such as a transaction, an AsyncLocalStorage context, or a tracing span. You **must** call `runTest()`/`runSuite()`. If you don't, the test or suite fails. `runTest()` includes the `beforeEach`/`afterEach` hooks and the test's fixtures. The first registered hook is the outermost.

```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { aroundEach, expect, test } from 'vitest'
import { currentTenant } from './tenant'

const als = new AsyncLocalStorage<{ tenant: string }>()

aroundEach(async (runTest) => {
  await als.run({ tenant: 'acme' }, runTest)
})

test('reads tenant from context', () => {
  expect(currentTenant(als)).toBe('acme')
})
```

If you only need code before and after a test, use `beforeEach` with a returned cleanup.

## Test Context

Each test's first argument is its context. Destructure the parts you use:

| Property | Purpose |
| --- | --- |
| `expect` | `expect` bound to this test. Required for snapshots and `expect.assertions` in concurrent tests |
| `task` | Read-only test metadata (`task.name`, `task.meta`, ...) |
| `skip(note?)` / `skip(condition, note?)` | Skip at runtime |
| `signal` | `AbortSignal` aborted on timeout, cancel, or bail ([async-testing.md](async-testing.md)) |
| `annotate(message, type?, attachment?)` | Attach notes to reporters ([annotations-filtering.md](annotations-filtering.md)) |
| `onTestFinished`, `onTestFailed` | Hooks for this test |
| `bench` | Benchmarks inside a test ([benchmarking.md](../testing-patterns/benchmarking.md)) |

## Fixtures with test.extend

Fixtures are values set up per test (by default) and torn down afterwards. They are **lazy**: a fixture is created only when a test (or another fixture) destructures it. Prefer the **builder pattern**, which infers types from return values.

```ts
// test/fixtures.ts
import { test as baseTest } from 'vitest'
import { createDatabase } from './db'

export const test = baseTest
  .extend('config', { apiUrl: 'http://localhost:3000' })          // static value
  .extend('db', { scope: 'file' }, async ({}, { onCleanup }) => {   // shared per file
    const db = await createDatabase()
    onCleanup(() => db.close())
    return db
  })
  .extend('user', async ({ db, task }, { onCleanup }) => {          // fresh per test
    const user = await db.createUser({ name: `user for ${task.name}` })
    onCleanup(() => db.deleteUser(user.id))
    return user
  })
```

```ts
// orders.test.ts
import { expect } from 'vitest'
import { test } from './test/fixtures'

test('user can place an order', async ({ db, user }) => {
  const order = await db.placeOrder(user.id, 'A-1')
  expect(order.userId).toBe(user.id)
})

test('needs no fixtures', () => {
  // db and user are never created here
})
```

Rules:

- **Destructure** fixtures in the test signature (`({ db })`). Do not write `(context) => context.db`.
- `onCleanup` can be called **once per fixture**. If you need two cleanups, split the fixture into two.
- `{ auto: true }` runs a fixture for every test even when no test uses it, for example to collect metrics.
- `{ injected: true }` lets a project override the default with `provide` ([projects.md](projects.md)).
- Extended `test` objects can be extended again, so you can layer `dbTest` → `apiTest`.
- Hooks on the extended object (`test.beforeEach`, `test.afterEach`, `test.aroundEach`, `test.beforeAll`, `test.afterAll`, `test.aroundAll`) receive the fixtures with types. Global `beforeAll` **cannot** see custom fixtures. Suite-level hooks can only use file- or worker-scoped fixtures.

```ts
import { test } from './test/fixtures'

test.aroundEach(async (runTest, { db }) => {
  await db.transaction(runTest)          // each test rolls back
})

test.beforeAll(async ({ db }) => {
  await db.migrate()
})
```

The Playwright-style object syntax is also supported. You must provide types yourself, and cleanup goes after `await use(value)`:

```ts
import { test as baseTest } from 'vitest'
import { createDatabase, type Database } from './db'

export const test = baseTest.extend<{ db: Database }>({
  db: async ({}, use) => {
    const db = await createDatabase()
    await use(db)
    await db.close()
  },
})
```

## Fixture Scopes

| Scope | Created | Can depend on |
| --- | --- | --- |
| `test` (default) | Per test | worker, file, test fixtures, and the test context |
| `file` | Once per test file | worker and file fixtures |
| `worker` | Once per worker | worker fixtures only |

- By default each file runs in its own worker, so `file` and `worker` behave the same. With `isolate: false`, a worker fixture is shared by every file in that worker. In `vmThreads`/`vmForks`, `worker` behaves like `file`.
- A file or worker fixture has no `task`. To get the file path, use `expect.getState().testPath`.
- Never let tests mutate a shared-scope fixture's state. Give each test its own data, or roll back with `aroundEach`.

## Overriding Fixtures with test.override

`test.override` replaces fixture values for the current `describe` and its children. Call it at the top level of the `describe` block. Nested suites can override again.

```ts
import { describe, expect, test as baseTest } from 'vitest'

const test = baseTest
  .extend('config', { port: 3000, host: 'localhost' })
  .extend('url', ({ config }) => `http://${config.host}:${config.port}`)

describe('production', () => {
  test.override('config', { port: 443, host: 'api.example.com' })

  test('uses overridden config', ({ url }) => {
    expect(url).toBe('http://api.example.com:443')
  })
})

test('uses defaults', ({ url }) => {
  expect(url).toBe('http://localhost:3000')
})
```

You can't add new fixtures or change `scope`/`auto` through an override, and you can't override `file`/`worker` fixtures inside a `describe`. `test.scoped` is a deprecated alias. Use `test.override`.

## setupFiles vs globalSetup, provide/inject

| | `setupFiles` | `globalSetup` |
| --- | --- | --- |
| Runs | Before **each test file**, in the test worker | **Once** in the main process, before workers start |
| Access to `vi`, `expect`, hooks, globals | Yes | No (different global scope) |
| Use for | `expect.extend`, polyfills, `afterEach(cleanup)`, global mocks | Starting servers or containers, migrating a DB once |
| Passing data to tests | Directly | `project.provide(key, value)` → `inject(key)` (serializable values) |

By default setup files run in the order they are listed (`sequence.setupFiles: 'list'`).

```ts
// globalSetup.ts
import type { TestProject } from 'vitest/node'
import { startPostgres } from './containers'

export default async function setup(project: TestProject) {
  const pg = await startPostgres()
  project.provide('dbUrl', pg.url)
  return async () => pg.stop()            // teardown
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string
  }
}
```

```ts
// users.test.ts
import { expect, inject, test } from 'vitest'

test('connects to the shared database', () => {
  expect(inject('dbUrl')).toMatch(/^postgres:/)
})
```

`globalSetup` runs only when at least one test is queued. In watch mode it does not run again on reruns. Use `project.onTestsRerun(cb)` for that. Static values can go straight into config `provide: { KEY: value }`.

## Execution Order

For one file with a suite (checked against 5.1.0):

```
setupFiles (in order)
file-level code and describe bodies (collection)
aroundAll before
  beforeAll
  for each test:
    aroundEach before
      beforeEach
        test
      afterEach            (reverse order)
      beforeEach cleanups  (reverse order)
      onTestFinished       (reverse order); onTestFailed if failed
    aroundEach after
  afterAll
  beforeAll cleanups
aroundAll after
```

With nested suites, the outer `beforeEach` runs before the inner one, and the inner `afterEach` runs before the outer one. `retry` and `repeats` rerun the whole per-test block.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `let x` + `beforeEach(() => { x = ... })` for typed resources | Untyped, setup and teardown far apart, created even when unused | `test.extend` fixture with `onCleanup` |
| Mutable data in `beforeAll` shared by tests | Order-dependent failures | `beforeEach` or a test-scoped fixture |
| Cleanup as the last line of the test | Skipped when an assertion fails | `onTestFinished`, a fixture `onCleanup`, or a `beforeEach` return |
| `(ctx) => ctx.db` in a fixture-based test | Fixture never initialized | Destructure `({ db })` |
| Global `beforeAll(({ db }) => ...)` with custom fixtures | `db` is undefined | `test.beforeAll` on the extended test |
| `aroundEach` that doesn't call `runTest()` | Test fails | Always `await runTest()` |
| Reading globalSetup variables from tests | Different process and scope | `provide`/`inject` |
| Heavy work in `setupFiles` | Runs again for every test file | `globalSetup` or a `worker`-scoped fixture |
| Using `test.scoped` | Deprecated | `test.override` |

## Related References

- **Test data factories**: [test-data.md](test-data.md)
- **DB transactions per test**: [integration-testing.md](../testing-patterns/integration-testing.md)
- **Config for setupFiles/globalSetup/provide**: [configuration.md](configuration.md)
- **Per-project injected fixtures**: [projects.md](projects.md)
- **Restoring mocks automatically**: [mock-functions.md](../mocking/mock-functions.md)
- **State leaking between tests**: [flaky-tests.md](../debugging/flaky-tests.md)
