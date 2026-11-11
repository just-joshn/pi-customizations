# Common Errors

## Table of Contents

1. [Install and Version Errors](#install-and-version-errors)
2. [Module Mocking Errors](#module-mocking-errors)
3. [Module Resolution Errors](#module-resolution-errors)
4. [ESM, CommonJS, and Dependencies](#esm-commonjs-and-dependencies)
5. [Environment and Globals](#environment-and-globals)
6. [Async Errors](#async-errors)
7. [Hanging Process and Worker Errors](#hanging-process-and-worker-errors)
8. [Memory](#memory)
9. [5.x Behavior Changes That Look Like Bugs](#5x-behavior-changes-that-look-like-bugs)

## Install and Version Errors

**Vitest cannot resolve `vite` (Yarn).** Since 5.0, `vite` is a required peer dependency, not a direct dependency. npm, pnpm, Bun, and Deno install peers automatically; Yarn doesn't.

```bash
yarn add -D vite
```

**Unexpected errors right after upgrading.** Vitest 5 requires Vite >= 6.4.0 and Node.js >= 22.12.0. Check both before debugging anything else:

```bash
node --version
npx vitest --version
npm ls vite
```

**Config not picked up when running from a subdirectory.** Since 5.0, config files are not looked up from parent directories. Pass it explicitly: `vitest --config ../vitest.config.ts`. See [projects.md](../core/projects.md) for monorepos.

## Module Mocking Errors

### `vi.mock` throws "defined outside of the module's top level scope"

**Version note (5.0):** `vi.mock`, `vi.unmock`, and `vi.hoisted` inside a function, block, `describe`, or `test` now throw (previously a warning). They are hoisted anyway, so move them to the top level. `vi.doMock`/`vi.doUnmock` are not hoisted and may be called anywhere.

```ts
import { describe, vi } from 'vitest'

vi.mock('./calculator') // top level

describe('calculator', () => {
  // ...
})
```

### "There was an error when mocking a module" / "Cannot access '__vi_import_0__' before initialization"

The factory runs before imports, so it can't reference top-level variables or imported bindings. Put shared values in `vi.hoisted`:

```ts
import { expect, test, vi } from 'vitest'
import { getUser } from './user'

const { fetchUser } = vi.hoisted(() => ({ fetchUser: vi.fn() }))

vi.mock(import('./api'), () => ({ fetchUser }))

test('loads the user', async () => {
  fetchUser.mockResolvedValue({ name: 'Ada' })
  expect(await getUser(1)).toEqual({ name: 'Ada' })
})
```

### `No "x" export is defined on the "./mod" mock`

The factory returned an object without that export. Return a partial mock built on the original:

```ts
import { vi } from 'vitest'

vi.mock(import('./math'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, total: vi.fn() }
})
```

Related: `vi.mock(...) is not returning an object. Did you mean to return an object with a "default" key?` means the factory must return the module namespace (e.g. `{ default: ... }` for default exports).

### Mock silently not applied

| Cause | Fix |
| --- | --- |
| `vi` imported from a helper module, not `vitest` | Import `vi` from `vitest` (hoisting is static analysis), or enable `globals` |
| Module loaded via `require()` | `vi.mock` only intercepts `import` |
| Module already imported in a `setupFiles` file | It's cached. Call `vi.resetModules()` inside `vi.hoisted`, or don't import it in setup |
| Path mismatch | Use `vi.mock(import('./path'))` so the path is checked and refactor-safe |
| Spying on an internal call within the same module | Mocks replace exports, not intra-module references. Split the module or inject the dependency |
| Browser Mode `vi.spyOn(namespace, 'fn')` throws | ESM namespaces are sealed. Use `vi.mock(path, { spy: true })` |
| 5.1 Browser Mode: "imported before vi.mock" error | Import-map mocking can't replace an already-loaded module. Ensure the mock is registered first, or set `browser.importMapMocks: false` |

See [module-mocking.md](../mocking/module-mocking.md).

## Module Resolution Errors

### `Cannot find module './relative-path'`

1. Check the path and extension.
2. Using `tsconfig.json` `paths`/`baseUrl`? Vite ignores them by default. Add `vite-tsconfig-paths`, or configure `resolve.alias`.
3. Relative aliases resolve relative to the importing file. Make them absolute:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    alias: {
      '@/': new URL('./src/', import.meta.url).pathname,
    },
  },
})
```

### Custom `exports` conditions ignored

In the `node` environment, Vitest resolves with `ssr.resolve.conditions` (default `import`, `default`). For jsdom/happy-dom/browser it uses `resolve.conditions`.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  ssr: { resolve: { conditions: ['custom', 'import', 'default'] } },
})
```

## ESM, CommonJS, and Dependencies

**Package works in the app but fails in Vitest** with `Unexpected token 'export'`, `Cannot use import statement outside a module`, `Unknown file extension ".css"`, or `seems to be an ES Module but shipped in a CommonJS package`. Vitest externalizes `node_modules`, so Node loads them directly and Node's ESM rules apply. Fix the package if you can; otherwise inline it **and every package in the import chain leading to it**:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ['wrapper-package', 'broken-package'],
      },
    },
  },
})
```

Vite's `ssr.resolve.noExternal` is merged into `server.deps.inline` and works too.

**CommonJS source.** `require()` bypasses Vite: no aliases, transforms, or mocks, and importing plus requiring the same file can evaluate it twice (broken singletons, `instanceof`). If the project doesn't need Vite transforms, set `experimental.viteModuleRunner: false`. For a CJS package inside a monorepo, externalize it whole with `server.deps.external`.

**Slow imports of large dependencies.** `deps.optimizer.{client,ssr}` with `enabled: true` and `include` bundles listed deps with esbuild. Optimized code lives in the cache dir, so edits to `node_modules` won't show up without `force`.

## Environment and Globals

| Error | Cause | Fix |
| --- | --- | --- |
| `document is not defined` / `window is not defined` | Default environment is `node` | `environment: 'jsdom'`/`'happy-dom'`, `// @vitest-environment jsdom`, or Browser Mode |
| `describe is not defined` / `expect is not defined` | `globals` defaults to `false` | Import from `vitest`, or `globals: true` |
| TS: `Cannot find name 'describe'` with `globals: true` | Types not registered | Add `"types": ["vitest/globals"]` to `tsconfig.json` |
| `@testing-library/*` DOM not cleaned between tests | Auto-cleanup relies on globals | `globals: true`, or call `cleanup` in `afterEach` |
| `process.env.TZ` ignored | `threads`/`vmThreads` workers keep the main process time zone | Set `TZ` in shell, config file, or `globalSetup` |

```json
{
  "compilerOptions": {
    "types": ["vitest/globals"]
  }
}
```

If you override `typeRoots`, add `./node_modules` back so `vitest/globals` resolves.

## Async Errors

**`Unhandled Rejection: Error: ...`.** A promise rejected without `await`/`.catch`. Usually an un-awaited call in the test:

```ts
import { expect, test } from 'vitest'

test('rejects for missing user', async () => {
  await expect(fetchUser(123)).rejects.toThrow('User 123 not found')
})
```

**Test fails pointing at an assertion you didn't await.** 5.x fails unawaited `.resolves`, `.rejects`, `toMatchFileSnapshot`, and `expect.poll`. Add `await`.

**`expect.poll() ... didn't resolve in time`.** 5.x fails polls that time out. Raise `timeout` only if the wait is legitimately long; otherwise the condition is never met.

**Timeouts.** Default `testTimeout` is 5000 ms. Look for a promise that never settles or fake timers not being advanced before raising it. See [async-testing.md](../core/async-testing.md).

## Hanging Process and Worker Errors

**`close timed out after 10000ms`** followed by `Tests closed successfully but something prevents Vite server from exiting` (or `...the main process from exiting`). Something keeps the event loop alive after the tests finish: an open server, DB connection, interval, or watcher. Vitest force-exits after `teardownTimeout` (default 10000 ms).

```bash
vitest run --reporter=hanging-process --reporter=default
```

Close handles in `afterAll`/fixture `onCleanup`. Use `--detectAsyncLeaks` to find the test file and source line that created the leaking timer or handle (slow; debug only).

**`Failed to terminate worker`.** Node's `fetch` with `pool: 'threads'`. Switch back to the default `pool: 'forks'`.

**Segfaults / `Abort trap: 6` / `panicked at`.** A native module that isn't thread-safe under `pool: 'threads'`. Use `pool: 'forks'`.

**`process.chdir()` fails, or `process.cwd()` isn't the project directory.** The `threads` pool can't `chdir`, and project `root` doesn't change the working directory. Use `pool: 'forks'` with a per-project setup file that calls `process.chdir`.

## Memory

- `logHeapUsage: true` (or `--logHeapUsage`) prints heap size after each test, showing which files grow memory.
- `vmThreads`/`vmForks` leak memory by design (VM contexts) and recycle workers at `vmMemoryLimit` (default `1 / maxWorkers` of system memory). Set it explicitly, e.g. `vmMemoryLimit: '1GB'` or `'25%'`. Percentages are wrong on Linux CircleCI.
- For large suites that recycle often, prefer `vmForks` over `vmThreads`: recycling a fork is just a process exit.
- Fewer `maxWorkers` means more memory per worker.

## 5.x Behavior Changes That Look Like Bugs

| Symptom after upgrading | Cause |
| --- | --- |
| Mock call counts reset between tests unexpectedly | `clearMocks` now defaults to `true` |
| `-t 'suite test'` matches nothing | `-t` matches `suite > test` |
| `expect(fn).toThrow('')` now passes for any error | Empty string is a normal substring; use `/^$/` for empty messages |
| `toHaveTextContent('Err')` fails on "Error!" | Strict equality; use `toMatchTextContent` |
| `getByText('Item')` no longer matches "Item 1" | Locators exact by default (`browser.locators.exact`) |
| `/__vitest__/` shows an error | UI needs the printed `?token=` URL |
| Automocked module returns `undefined` in browser | Correct automock behavior now; use `{ spy: true }` |
| `VITEST_POOL_ID` off by one | Worker ids are 1-based |
| `describe.sequential is not a function` | Removed; use `{ concurrent: false }` |
| Inline projects pick up root plugins/aliases | Inline projects inherit root config by default |

Full list: [migration.md](../architecture/migration.md).

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Raising `testTimeout` to fix a hang | Masks a never-settling promise | Find the missing `await`/resolve; advance fake timers |
| Inlining only the broken package | Its importer is still externalized | Inline the whole import chain |
| Referencing outer variables in a `vi.mock` factory | Hoisting runs factory first | `vi.hoisted` |
| `vi.mock` in `beforeEach` to vary mocks | Throws in 5.x | Top-level `vi.mock` + per-test `mockReturnValue` |
| Relative alias paths | Resolve per importing file | Absolute paths via `new URL(..., import.meta.url)` |
| Ignoring "close timed out" | Leaked handles slow CI and hide bugs | `hanging-process` reporter, close resources |
| Setting `process.env.TZ` in tests | No effect in thread pools | Set before workers start |

## Related References

- [debugging.md](debugging.md) - isolating and stepping through failures
- [flaky-tests.md](flaky-tests.md) - leaks, order dependence, retries
- [module-mocking.md](../mocking/module-mocking.md) - `vi.mock`, `vi.hoisted`, partial mocks
- [configuration.md](../core/configuration.md) - config file, aliases, deps
- [dom-environments.md](../testing-patterns/dom-environments.md) - jsdom/happy-dom
- [performance.md](../infrastructure-ci-cd/performance.md) - pools and workers
- [migration.md](../architecture/migration.md) - Jest and 4.x → 5.x
