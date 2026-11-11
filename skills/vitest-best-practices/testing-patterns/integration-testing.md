# Integration Testing (Databases, Servers, Containers)

## Table of Contents

1. [Scope and Layout](#scope-and-layout)
2. [Choosing Where Setup Lives](#choosing-where-setup-lives)
3. [Expensive Resources as Scoped Fixtures](#expensive-resources-as-scoped-fixtures)
4. [Transaction per Test](#transaction-per-test)
5. [One Connection per Worker](#one-connection-per-worker)
6. [globalSetup with provide / inject](#globalsetup-with-provide--inject)
7. [Isolating Workers: VITEST_POOL_ID](#isolating-workers-vitest_pool_id)
8. [Files That Must Run Sequentially](#files-that-must-run-sequentially)
9. [Timeouts and Diagnostics](#timeouts-and-diagnostics)

## Scope and Layout

Integration tests run real collaborators (database, HTTP server, queue) instead of mocks. They are slower and need setup, so keep them identifiable and separately runnable:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', exclude: ['**/*.int.{test,spec}.ts', '**/node_modules/**'] } },
      {
        test: {
          name: 'integration',
          include: ['**/*.int.{test,spec}.ts'],
          globalSetup: ['./test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
```

```bash
npx vitest run --project integration
```

Each test must start from a known state and leave none behind. The patterns below get you there without truncating tables between every test.

## Choosing Where Setup Lives

| Need | Use | Runs |
| --- | --- | --- |
| Start a server/container once for the whole run | `globalSetup` + `project.provide` | Once, in the main process, before workers |
| Share a connection across tests in a file | fixture with `scope: 'file'` | Once per file |
| Share a connection across files in a worker | fixture with `scope: 'worker'` + `isolate: false` | Once per worker |
| Fresh data per test | test-scoped fixture, or `aroundEach` transaction | Per test |
| Wrap each test in a context (transaction, AsyncLocalStorage) | `aroundEach` / `test.aroundEach` | Per test |

`globalSetup` runs in a different process from tests: tests can't see its variables, only serializable values passed through `provide`/`inject`. `setupFiles` run inside each test file's worker, before every file.

## Expensive Resources as Scoped Fixtures

Fixtures are created only when a test uses them, and the builder form type-checks scope rules. Use the builder form (`.extend(name, options, fn)`) with `onCleanup`.

```ts
// test/int-test.ts
import { test as baseTest } from 'vitest'
import { createPool } from '../src/db'

export const test = baseTest
  .extend('db', { scope: 'file' }, async ({}, { onCleanup }) => {
    const db = await createPool(process.env.DATABASE_URL!)
    onCleanup(() => db.end())
    return db
  })
  .extend('user', async ({ db }, { onCleanup }) => {
    const user = await db.users.create({ email: `u-${crypto.randomUUID()}@example.com` })
    onCleanup(() => db.users.delete(user.id))
    return user
  })
```

```ts
// src/orders.int.test.ts
import { expect } from 'vitest'
import { test } from '../test/int-test'

test('creates an order for the user', async ({ db, user }) => {
  const order = await db.orders.create({ userId: user.id, total: 42 })
  expect(order).toMatchObject({ userId: user.id, status: 'pending' })
})
```

Rules:

- A fixture can only use fixtures of the same or longer-lived scope (`worker` → `file` → `test`). Only test-scoped fixtures see the test context (`task`, `expect`).
- `onCleanup` may be called **once** per fixture. Split resources into separate fixtures rather than registering two cleanups.
- Use unique data per test (random IDs/emails) so tests don't collide when files run in parallel.
- Fixture details: [fixtures-hooks.md](../core/fixtures-hooks.md).

## Transaction per Test

Wrap each test in a transaction that is rolled back, so nothing is committed and no per-test cleanup is needed. This is the recipe from the Vitest docs:

```ts
// test/db-test.ts
import { test as baseTest } from 'vitest'
import { createTestDatabase } from './db'

export const test = baseTest
  .extend('db', { scope: 'file' }, async ({}, { onCleanup }) => {
    const db = await createTestDatabase()
    onCleanup(() => db.close())
    return db
  })

test.aroundEach(async (runTest, { db }) => {
  await db.transaction(runTest) // helper must roll back after runTest resolves
})

test('insert user', async ({ db }) => {
  await db.insert({ name: 'Alice' })
  // rolled back when the test ends
})
```

- `runTest()` runs `beforeEach`, the test, its fixtures, and `afterEach`, so fixtures created inside the test also run inside the transaction. You must call it.
- `test.aroundEach` (rather than the standalone `aroundEach`) gives typed access to fixtures.
- The driver must support nested transactions or savepoints if the code under test opens its own transactions.
- Code that uses a **different** connection (a background worker, a second pool) won't see uncommitted rows. Run that code on the test's connection, or fall back to truncation for those tests.
- For simple before/after work without wrapping, prefer `beforeEach` returning a cleanup function.

## One Connection per Worker

By default each test file gets its own worker, so `scope: 'file'` and `scope: 'worker'` behave the same. With `isolate: false`, workers are reused across files (up to `maxWorkers`), and a worker-scoped fixture is created once per worker: 200 files on 8 workers → 8 connections instead of 200.

```ts
// vitest.config.ts — integration project only
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { isolate: false },
})
```

```ts
export const test = baseTest
  .extend('db', { scope: 'worker' }, async ({}, { onCleanup }) => {
    const db = await createTestDatabase()
    onCleanup(() => db.close())
    return db
  })
```

Trade-off: with isolation off, files in the same worker share module state (caches, singletons, patched globals). The rollback protects database rows, not module state. `vmThreads`/`vmForks` always isolate, so worker scope falls back to per-file there.

## globalSetup with provide / inject

Start shared infrastructure once, pass connection details to tests, and stop it at the end.

```ts
// test/global-setup.ts
import type { TestProject } from 'vitest/node'
import { startPostgres } from './containers'

export default async function setup(project: TestProject) {
  const pg = await startPostgres()
  project.provide('databaseUrl', pg.url)

  project.onTestsRerun(async () => {
    await pg.reset() // watch mode: reset before each rerun
  })

  return async () => {
    await pg.stop()
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}
```

```ts
// test/int-test.ts
import { inject, test as baseTest } from 'vitest'
import { createPool } from '../src/db'

export const test = baseTest.extend('db', { scope: 'file' }, async ({}, { onCleanup }) => {
  const db = await createPool(inject('databaseUrl'))
  onCleanup(() => db.end())
  return db
})
```

- `globalSetup` runs only if at least one test is queued; teardown runs after all files finish (in watch mode, on exit).
- Multiple global setup files run in order; teardowns in reverse.
- Provided values must be serializable (structured clone). Don't try to pass a client instance.
- Static per-project values can go straight in config: `provide: { apiUrl: '...' }`.
- A fixture with `{ injected: true }` takes its value from the project's `provide` and falls back to its default.

## Isolating Workers: VITEST_POOL_ID

Files run in parallel workers, so tests in different files can hit the same database at the same time. If transaction rollback isn't enough (e.g. the code commits), give each worker its own database or schema.

**Version note (5.0):** `VITEST_POOL_ID` and `VITEST_WORKER_ID` are **1-based**. `VITEST_POOL_ID` ranges from `1` to the worker count (`maxWorkers`); `VITEST_WORKER_ID` is unique per worker. Code that used them as 0-based array indexes or database suffixes must be updated.

```ts
export const test = baseTest.extend('db', { scope: 'worker' }, async ({}, { onCleanup }) => {
  const poolId = process.env.VITEST_POOL_ID // "1", "2", ...
  const db = await createPool(`${inject('databaseUrl')}_w${poolId}`)
  await db.migrate()
  onCleanup(() => db.end())
  return db
})
```

`VITEST_POOL_ID` is the right key for per-worker resources: it stays within `1..maxWorkers`, so pre-creating `maxWorkers` databases in `globalSetup` covers every worker. Node and browser tests run in separate pools and can share the same id values.

## Files That Must Run Sequentially

For a few files that need an exclusive resource (a fixed port, a shared schema without isolation), split them into their own project with `fileParallelism: false`, and run them after the parallel batch with `sequence.groupOrder`:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'parallel',
          exclude: ['**/*.sequential.{test,spec}.ts', '**/node_modules/**'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'sequential',
          include: ['**/*.sequential.{test,spec}.ts'],
          fileParallelism: false, // same as maxWorkers: 1
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
```

`fileParallelism` controls files; tests inside a file are already sequential unless marked `concurrent`. Don't mark integration tests `concurrent` when they share a connection or transaction.

## Timeouts and Diagnostics

- Raise `testTimeout`/`hookTimeout` for the integration project only, not globally. `aroundEach`/`aroundAll` accept a timeout argument that applies separately to the setup and teardown phases (default `hookTimeout`, 10 s).
- Wait for readiness with `vi.waitFor(() => ping(), { timeout: 10_000, message: 'db ready' })` instead of fixed sleeps. In 5.1, `experimental.traceTimeline` prints these waits under a failing test.
- A hanging run after tests finish usually means an open handle (pool, server) that was never closed. Check every resource has `onCleanup` / teardown.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Connecting in `beforeAll` in every file by hand | Duplicated, untyped, easy to forget teardown | Scoped fixture with `onCleanup` |
| Truncating all tables in `beforeEach` | Slow, races with parallel files | Transaction per test via `test.aroundEach` |
| Fixed IDs/emails in test data | Collisions between parallel files | Random/unique values per test |
| Passing a client object through `provide` | Must be serializable; crosses processes | Provide a URL/port; create the client in a fixture |
| `VITEST_POOL_ID - 0` / 0-based index logic | Ids are 1-based in 5.x | Use the id as-is (`1..maxWorkers`) |
| `isolate: false` suite-wide to save connections | Module state leaks between files | Only for the integration project, after checking for shared state |
| Global `testTimeout: 60_000` | Hides slow unit tests | Raise timeouts on the integration project only |
| `setTimeout` sleeps waiting for a container | Flaky and slow | `vi.waitFor` with a readiness probe |
| `concurrent` tests sharing one transaction | Interleaved queries, nondeterministic results | Keep tests within a file sequential |

## Related References

- **Fixtures, hooks, aroundEach**: [fixtures-hooks.md](../core/fixtures-hooks.md)
- **Test data factories**: [test-data.md](../core/test-data.md)
- **Projects and config**: [projects.md](../core/projects.md), [configuration.md](../core/configuration.md)
- **Pools, isolation, workers**: [performance.md](../infrastructure-ci-cd/performance.md)
- **Mock or real dependency?**: [when-to-mock.md](../architecture/when-to-mock.md)
- **Flaky and order-dependent tests**: [flaky-tests.md](../debugging/flaky-tests.md)
