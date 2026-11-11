# Migration: Jest → Vitest and Vitest 4 → 5

## Table of Contents

1. [Migration Workflow](#migration-workflow)
2. [Jest → Vitest: Config](#jest--vitest-config)
3. [Jest → Vitest: API Mapping](#jest--vitest-api-mapping)
4. [Jest → Vitest: Behavior Differences](#jest--vitest-behavior-differences)
5. [Vitest 4 → 5: Runtime and Test API](#vitest-4--5-runtime-and-test-api)
6. [Vitest 4 → 5: Config, Projects, Coverage](#vitest-4--5-config-projects-coverage)
7. [Vitest 4 → 5: Browser Mode](#vitest-4--5-browser-mode)
8. [Vitest 4 → 5: Output, Tooling, Advanced APIs](#vitest-4--5-output-tooling-advanced-apis)

## Migration Workflow

1. Check versions: `npx vitest --version`. Vitest 5 requires **Node >= 22.12.0** and **Vite >= 6.4.0**. If the project is on Vitest < 4, apply the 4.0 migration guide first.
2. Get a green baseline on the old version and record the test count.
3. Apply changes in small commits, and run `vitest run` after each one.
4. Compare test counts. A drop usually means `include`, `-t` patterns, or project config changed what gets collected.
5. Run `tsc --noEmit`. Many 5.0 changes are type-level, such as `Assertion<R, T>` and `Matchers<R, T>`.

## Jest → Vitest: Config

| Jest                                   | Vitest (`test.*` unless noted)                                  |
| -------------------------------------- | --------------------------------------------------------------- |
| globals on by default                  | `globals: false` by default. Import from `vitest`, or set `globals: true` plus `"types": ["vitest/globals"]` |
| `testEnvironment`                      | `environment` (`node` default, `jsdom`, `happy-dom`)            |
| `testMatch`                            | `include`                                                       |
| `setupFiles` / `setupFilesAfterEnv`    | `setupFiles` (runs before each test file)                       |
| `moduleNameMapper`                     | Vite `resolve.alias` (or `test.alias`)                          |
| `snapshotSerializers`                  | `snapshotSerializers`                                           |
| `jest.setTimeout(n)`                   | `testTimeout` config, or `vi.setConfig({ testTimeout: n })`     |
| `JEST_WORKER_ID`                       | `VITEST_POOL_ID` (≤ `maxWorkers`), or `VITEST_WORKER_ID` (unique per worker) |
| hooks run in declaration order         | hooks run as a stack. Set `sequence.hooks: 'list'` for Jest order |

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    sequence: { hooks: 'list' }, // only if tests depend on Jest's hook order
  },
})
```

With globals disabled, `@testing-library/*` does **not** auto-cleanup. Call `cleanup` in an `afterEach`, or enable `globals`.

## Jest → Vitest: API Mapping

| Jest                                       | Vitest                                                          |
| ------------------------------------------ | --------------------------------------------------------------- |
| `jest.fn` / `jest.spyOn` / `jest.mocked`   | `vi.fn` / `vi.spyOn` / `vi.mocked`                              |
| `jest.mock` / `jest.doMock` / `jest.unmock` | `vi.mock` / `vi.doMock` / `vi.unmock`                          |
| `jest.requireActual(p)`                    | `await vi.importActual(p)`, or the factory's `importOriginal`   |
| `jest.requireMock(p)`                      | `await vi.importMock(p)`                                        |
| `jest.resetModules()`                      | `vi.resetModules()`                                             |
| `jest.useFakeTimers()`                     | `vi.useFakeTimers()`. Legacy timers are **not supported**       |
| `jest.advanceTimersByTime` / `runAllTimers` / `runOnlyPendingTimers` | same names on `vi`                    |
| `jest.setSystemTime`                       | `vi.setSystemTime`                                              |
| `jest.clearAllMocks` / `resetAllMocks` / `restoreAllMocks` | same names on `vi`                              |
| `jest.replaceProperty`                     | `vi.stubEnv` (env) or `vi.spyOn(obj, 'prop', 'get')`            |
| `jest.Mock<T>` type                        | `import type { Mock } from 'vitest'`                            |
| `require('jest-snapshot').toMatchSnapshot` | `import { Snapshots } from 'vitest'`                            |

```ts
import { expect, test, vi } from 'vitest'
import { getUser } from './api'

// factory must return named exports; it may be async
vi.mock(import('./api'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getUser: vi.fn() }
})

test('uses the mock', async () => {
  vi.mocked(getUser).mockResolvedValue({ id: 1 })
  await expect(getUser(1)).resolves.toEqual({ id: 1 })
})
```

## Jest → Vitest: Behavior Differences

- **Module factories return the module object.** In Jest, `() => 'hello'` becomes the default export. In Vitest, return `{ default: 'hello' }`.
- **`__mocks__` are not auto-applied.** Files in `<root>/__mocks__` load only when you call `vi.mock(path)`. Put those calls in `setupFiles` to mock modules everywhere.
- **Mocking inside third-party packages** requires adding them to `server.deps.inline`.
- **`mockReset` restores the original implementation** (`vi.fn(impl)` → `impl`). Jest replaces it with `() => undefined`.
- **`mock.mock` is persistent.** A reference held before `mockClear()` stays valid.
- **No `done` callback.** Use `async` or return a Promise:

```ts
import { expect, test } from 'vitest'

test('emits ready', async () => {
  const value = await new Promise<string>((resolve) => emitter.once('ready', resolve))
  expect(value).toBe('ok')
})
```

- **Hook return values are teardown functions.** Make arrow-bodied hooks return nothing:

```diff
- beforeEach(() => setActivePinia(createTestingPinia()))
+ beforeEach(() => { setActivePinia(createTestingPinia()) })
```

- **Full names are joined with `' > '`** (`expect.getState().currentTestName`, `-t`). Update `-t 'suite test'` to `-t 'suite > test'`.
- **Snapshots:** the header changes to `// Vitest Snapshot v1`, and `printBasicPrototype` defaults to `false` (no `Object {` / `Array [`; Jest < 29 defaulted to `true`). Re-record the snapshots and review the diff. Vue-cli users need the `jest-serializer-vue` snapshot serializer.
- **`clearMocks` is `true` by default** in Vitest 5. Jest defaults it to `false`.

## Vitest 4 → 5: Runtime and Test API

**`clearMocks` defaults to `true`.** Call history is cleared before every test. Calls recorded in setup files, at module top level, or in `beforeAll` are gone by the time a test asserts on them. Move those assertions into the test, or set `clearMocks: false`.

**`test.sequential`, `describe.sequential`, and the `sequential` option were removed:**

```diff
- test.sequential('a', async () => {})
+ test('a', { concurrent: false }, async () => {})
- describe.sequential('suite', () => {})
+ describe('suite', { concurrent: false }, () => {})
```

**Unawaited async assertions fail the test.** This covers `.resolves`, `.rejects`, and `toMatchFileSnapshot`. In 4.x Vitest auto-awaited them and printed a warning.

```ts
import { expect, test } from 'vitest'

test('awaits async assertions', async () => {
  await expect(Promise.resolve(1)).resolves.toBe(1)
})
```

**`expect.poll` rejects on timeout**, even if a late attempt would pass. Its callback now receives `{ signal }`. Raise `timeout` for legitimately slow polls.

**Hoisted calls must be at top level.** `vi.mock`, `vi.unmock`, and `vi.hoisted` inside a function or `describe` now **throw**. `vi.doMock` and `vi.doUnmock` are still allowed anywhere.

**Class mocks keep prototype methods.** With `vi.fn(Dog)`, instances now have `speak()` and pass `instanceof Dog`. Remove workarounds that re-added methods.

**`toThrow('')` matches any error.** To assert an empty message, use `toThrow(/^$/)`.

**`testNamePattern` (`-t`) matches the `' > '`-joined full name.** `-t 'math adds'` becomes `-t 'math > adds'`, or `-t 'math.*adds'`.

**Test titles use `pretty-format`.** `$id` string placeholders are no longer quoted (`case a1`, not `case 'a1'`). Truncation is set by `taskTitleValueFormatTruncate` (default 40). Update snapshots or `-t` filters that captured old titles.

**Fake timers and `setSystemTime` mock `Temporal`** when it exists globally. To opt out, pass `vi.useFakeTimers({ toNotFake: ['Temporal'] })`.

**Benchmarks are rewritten.** `bench` is now a test-context fixture. `bench.skip`/`only`/`todo`, `benchmark.reporters`/`outputFile`/`compare`/`outputJson`, `--compare`, and `--outputJson` are removed:

```ts
import { test } from 'vitest'

test('sort', async ({ bench }) => {
  await bench('sort', () => { [3, 1, 2].sort() }).run()
})
```

**Assertion and matcher types take the return type first.** Use `Assertion<void, string>` and `interface Matchers<R, T> { toBeFoo: () => R }`. Vitest no longer reads `jest.Matchers` augmentations, so augment `vitest`'s `Matchers` directly.

**`VITEST_POOL_ID` and `VITEST_WORKER_ID` are 1-based.** Fix per-worker DB names and array indexes that assumed 0.

**DOM env globals:** assignments to `window`/`globalThis` properties in jsdom and happy-dom now reach the underlying window. Setting `innerWidth`, for example, affects happy-dom's `matchMedia`.

## Vitest 4 → 5: Config, Projects, Coverage

- **Yarn:** `vite` is a peer dependency. Run `yarn add -D vite`.
- **Config files are not looked up in parent directories.** Use `cd subdir && vitest --config ../vitest.config.ts`.
- **Inline projects inherit the root config** (`extends` defaults to `true`), including `plugins` and `resolve.alias`. Arrays like `setupFiles` are appended. Remove redundant `extends: true`, and add `extends: false` where a project must not inherit.
- **Referenced config files can declare nested `projects`.** Don't `mergeConfig` the root config (which has `projects`) into a package config. Merge a shared base config instead.
- **`sharedViteServer: true`.** Inline projects that don't change Vite config share one server, so plugins are instantiated once. Set `sharedViteServer: false` if a plugin must run per project.
- **`fsModuleCache`** moved out of `experimental` and is **on by default**.
- **Coverage `include`/`exclude`** match root-relative paths, without `contains`. `'src'` means `src/**`. Re-check the reported file set.
- **Glob coverage thresholds don't inherit `perFile`.** Add `perFile: true` to each glob. See [coverage.md](../infrastructure-ci-cd/coverage.md).
- **Custom environments:** `populateGlobal().originals` now holds property descriptors. Restore them with `Object.defineProperty`.

## Vitest 4 → 5: Browser Mode

- **Locators are exact by default.** `getByText('Item')` no longer matches `Item 1`. Set `browser.locators.exact: false` to restore the old behavior.
- **`toHaveTextContent` is strict equality and rejects RegExp.** Use `toMatchTextContent` for partial or regex matches:

```ts
import { expect } from 'vitest'
import { page } from 'vitest/browser'

const banner = page.getByRole('alert')
await expect.element(banner).toMatchTextContent(/error/i)
await expect.element(banner).toHaveTextContent('Error!')
```

- **`render` is async** in `vitest-browser-vue` and `vitest-browser-svelte`. Write `const screen = await render(Component)`.
- **Automocked modules stay automocked.** `vi.mock(path)` without a factory now returns stubs in the browser. Use `{ spy: true }` to keep the real implementation.
- **`browser.api` → top-level `api`.** The default browser-mode port is `23315`. `browser.isolate` now warns; use `isolate`.
- **Custom commands** receive a `SerializedLocator` (`{ selector, locator }`) instead of a selector string.
- **Failure screenshots** move to `.vitest/attachments/failure-screenshots/`. Set `toMatchScreenshot` references with `browser.expect.toMatchScreenshot.screenshotDirectory` (default `__screenshots__`). If you had customized `browser.screenshotDirectory`, set the new option too.
- **Orchestrator URLs need a `sessionId`.** Use the URL that Vitest prints.
- **WebdriverIO provider** moved to the community (`vitest-community/vitest-webdriverio`).

## Vitest 4 → 5: Output, Tooling, Advanced APIs

- **Everything goes to `.vitest/`:** blob → `.vitest/blob/`, html → `.vitest/index.html` (`outputDir` replaces `outputFile`), json → `.vitest/json/output.json`, junit → `.vitest/junit/output.xml`, attachments → `.vitest/attachments/`. JSON and JUnit **no longer print to stdout**. Use `[['json', { stdout: true }]]` or read the file. See [reporters.md](../infrastructure-ci-cd/reporters.md).
- **Vitest UI requires a token URL.** Open the URL printed by `vitest --ui`.
- **Removed entry points:** `vitest/coverage` and `vitest/reporters` → `vitest/node`. `vitest/environments` and `vitest/snapshot` → `vitest/runtime`. `vitest/runners` → `TestRunner` from `vitest`. `vitest/suite` → static methods on `TestRunner`. `vitest/mocker` → `@vitest/mocker`. `vitest/internal/module-runner` was removed.
- **`@vitest/expect` no longer shares state with Vitest.** Use `expect`, `expect.extend`, and `chai` from `vitest`. `@vitest/runner` and `@vitest/ws-client` are deprecated.
- **`resolveConfig()`** (from `vitest/node`) returns the Vite config. The Vitest config is on `.test`.
- **Reporters:** `TestModule.diagnostic()` adds `concurrencyId`, and `workerId` is now 1-based.

## Anti-Patterns to Avoid

| Anti-Pattern                                         | Problem                                                     | Solution                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Global find-replace `jest.` → `vi.` and done         | Misses factory shape, `__mocks__`, `mockReset`, `done`, hook returns | Work through the behavior differences above        |
| `vi.mock` inside `describe` or a helper              | Throws in 5.x; was always hoisted anyway                    | Top-level `vi.mock`, or `vi.doMock` for dynamic cases      |
| Asserting calls recorded in `beforeAll`              | Cleared by the 5.x `clearMocks` default                     | Record and assert inside the test                          |
| Leaving `expect(p).resolves...` unawaited            | Fails the test in 5.x                                       | `await` every async assertion                              |
| Upgrading without comparing test counts              | Changes to `include`, `-t`, or projects silently drop tests | Compare collected counts before and after                  |
| Accepting all snapshot diffs after migrating         | Hides real regressions among format-only changes           | Review diffs; format changes should be uniform             |
| Keeping 0-based `VITEST_POOL_ID` math                | Off-by-one DB or port names in 5.x                          | Treat ids as 1-based                                       |
| Expecting JSON reporter output on stdout             | 5.x writes to `.vitest/json/output.json`                    | Read the file, or set `stdout: true`                       |
| Skipping prerequisites (Node < 22.12, Vite < 6.4)    | Unsupported; odd runtime errors                             | Upgrade Node and Vite first                                |

## Related References

- **Mocking modules and factories**: [module-mocking.md](../mocking/module-mocking.md)
- **Mock functions and classes**: [mock-functions.md](../mocking/mock-functions.md)
- **Fake timers and Temporal**: [timers-dates.md](../mocking/timers-dates.md)
- **Snapshots**: [snapshots.md](../testing-patterns/snapshots.md)
- **Projects config**: [projects.md](../core/projects.md)
- **Browser Mode**: [browser-mode.md](../testing-patterns/browser-mode.md)
- **Reporters and `.vitest` output**: [reporters.md](../infrastructure-ci-cd/reporters.md)
- **Coverage changes**: [coverage.md](../infrastructure-ci-cd/coverage.md)
