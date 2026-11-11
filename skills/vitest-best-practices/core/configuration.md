# Configuration

## Table of Contents

1. [Which Config File Is Used](#which-config-file-is-used)
2. [defineConfig and mergeConfig](#defineconfig-and-mergeconfig)
3. [Finding Test Files](#finding-test-files)
4. [Environment](#environment)
5. [Globals](#globals)
6. [Setup Files and Global Setup](#setup-files-and-global-setup)
7. [Timeouts, Retries, Assertions](#timeouts-retries-assertions)
8. [Automatic Mock and Stub Reset](#automatic-mock-and-stub-reset)
9. [Aliases](#aliases)
10. [Output Directory](#output-directory)
11. [A Solid Default Config](#a-solid-default-config)

## Which Config File Is Used

When `--config` is not given, Vitest looks **in the project root** for `vitest.config.{ts,mts,cts,js,mjs,cjs}` first and then `vite.config.{ts,mts,cts,js,mjs,cjs}`. If it finds neither, it runs without a config.

- If a `vitest.config.*` exists, Vitest **ignores** `vite.config.*` completely. Plugins and `resolve.alias` from the Vite config do not apply unless you merge them in (see below).
- Vite options (`plugins`, `resolve`, `define`) go at the top level. Vitest options go under `test`.
- During tests, `process.env.VITEST` is set and `mode` is `'test'`. A shared `vite.config` can branch on either.

> **Version note:** In 5.x Vitest **no longer searches parent directories** for a config. If you run `vitest` from a subdirectory, pass `--config ../vitest.config.ts` and, if needed, `--dir`.

## defineConfig and mergeConfig

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

Reuse the app's Vite config (plugins, aliases) with `mergeConfig`:

```ts
// vitest.config.ts
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
  },
}))
```

If `vite.config` exports a function, call it: `defineConfig(env => mergeConfig(viteConfig(env), defineConfig({ test: {} })))`.

To keep a single file, add `test` to `vite.config.ts` and reference the types:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  test: { environment: 'jsdom' },
})
```

Use `defineProject` in per-package configs referenced from `test.projects`. It type-errors on root-only options such as `reporters` and `coverage` ([projects.md](projects.md)).

## Finding Test Files

| Option | Default |
| --- | --- |
| `include` | `['**/*.{test,spec}.?(c|m)[jt]s?(x)']` |
| `exclude` | `['**/node_modules/**', '**/.git/**']` |
| `includeSource` | `[]` (in-source tests; see [test-structure.md](test-structure.md#in-source-testing)) |
| `dir` | Same as `root`. Narrows the directory that is scanned |

Setting `include` or `exclude` **replaces** the default. Spread `configDefaults` to extend it:

```ts
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**', 'e2e/**'],
  },
})
```

`--exclude` on the CLI **adds** to the config value. `exclude` does not affect coverage. Use `coverage.exclude` for that ([coverage.md](../infrastructure-ci-cd/coverage.md)).

Keep Playwright or other E2E specs out of Vitest's glob. Either name them differently or exclude their folder.

## Environment

`environment` defaults to `'node'`. The other built-ins are `'jsdom'`, `'happy-dom'`, and `'edge-runtime'`. The DOM environments need the `jsdom` or `happy-dom` package installed. Override per file with a comment at the top:

```ts
// @vitest-environment happy-dom
import { expect, test } from 'vitest'

test('creates an element', () => {
  expect(document.createElement('div')).not.toBeNull()
})
```

Use [projects](projects.md) to give whole groups of files different environments. See [dom-environments.md](../testing-patterns/dom-environments.md) and [browser-mode.md](../testing-patterns/browser-mode.md).

## Globals

`globals` defaults to `false`. Import from `vitest` explicitly. To use Jest-style globals:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { globals: true },
})
```

```json
{
  "compilerOptions": {
    "types": ["vitest/globals"]
  }
}
```

Some libraries, such as `@testing-library/react`, rely on a global `afterEach` for automatic cleanup. Without globals, register the cleanup yourself in a setup file.

## Setup Files and Global Setup

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],        // runs in the worker before EACH test file
    globalSetup: ['./test/global-setup.ts'], // runs ONCE in the main process
    provide: { API_BASE: 'http://localhost:4000' }, // read with inject('API_BASE')
  },
})
```

```ts
// test/setup.ts
import { afterEach, expect } from 'vitest'
import { cleanup } from './dom-cleanup'
import * as matchers from './matchers'

expect.extend(matchers)
afterEach(() => cleanup())
```

- Exports from setup files are ignored. Editing a setup file reruns every test.
- Setup files run in list order by default (`sequence.setupFiles: 'list'`). Use `'parallel'` to run them in parallel.
- Data passed with `provide` must be serializable. Augment `ProvidedContext` for types. See [fixtures-hooks.md](fixtures-hooks.md#setupfiles-vs-globalsetup-provideinject).

## Timeouts, Retries, Assertions

| Option | Default | Notes |
| --- | --- | --- |
| `testTimeout` | 5000 (15000 in browser mode) | `0` disables |
| `hookTimeout` | 10000 (30000 in browser mode) | |
| `retry` | `0` | Number or `{ count, delay, condition: RegExp }` |
| `repeats` | `0` | Run each test N more times. Use it for flake hunting |
| `bail` | `0` | Stop after N failures |
| `allowOnly` | `!process.env.CI` | `.only` fails the run in CI |
| `expect.requireAssertions` | `false` | Every test must run at least one `expect` |
| `expect.poll` | `{ interval: 50, timeout: 1000 }` | Defaults for `expect.poll` |
| `sequence.shuffle` / `sequence.seed` | `false` / `Date.now()` | Random order to expose order dependence |
| `sequence.concurrent` | `false` | All tests concurrent unless `{ concurrent: false }` |
| `maxConcurrency` | `5` | Cap for concurrent tests and hooks |

`retry.condition` in a config file must be a RegExp, because config is serialized to workers. A function condition is only allowed in test files. To change options for a single file at runtime, use `vi.setConfig({ testTimeout: 20_000 })` and `vi.resetConfig()`.

## Automatic Mock and Stub Reset

| Option | Default | Calls before each test | Effect |
| --- | --- | --- | --- |
| `clearMocks` | **`true`** | `vi.clearAllMocks()` | Clears call history, keeps implementations |
| `mockReset` | `false` | `vi.resetAllMocks()` | Clears history and resets implementations |
| `restoreMocks` | `false` | `vi.restoreAllMocks()` | Restores originals of `vi.spyOn` spies |
| `unstubEnvs` | `false` | `vi.unstubAllEnvs()` | Undoes `vi.stubEnv` |
| `unstubGlobals` | `false` | `vi.unstubAllGlobals()` | Undoes `vi.stubGlobal` |

> **Version note:** `clearMocks` is **on by default in 5.x**. Mocks no longer carry calls from one test to the next. Calls recorded in a setup file, at module top level, or in `beforeAll` are cleared before the test that asserts on them. Assert in the test, or set `clearMocks: false`.

Recommended for most projects: `restoreMocks: true`, `unstubEnvs: true`, `unstubGlobals: true`. All of these reset state globally before *any* test starts, so they are unsafe for mocks shared across `test.concurrent` tests.

## Aliases

Prefer Vite's `resolve.alias` so the app and the tests resolve paths the same way. `test.alias` is merged with `resolve.alias` and applies only to tests.

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
```

Aliases apply to `import` statements in inlined modules (all source code is inlined by default). They do not apply to `require` calls.

## Output Directory

> **Version note:** 5.x writes generated artifacts to one `.vitest/` directory at the project root: attachments, browser failure screenshots, blob reports, the HTML report, and the `json`/`junit` reporter files. The `json` and `junit` reporters now **write a file** by default instead of printing to stdout. Add `.vitest` to `.gitignore`. See [reporters.md](../infrastructure-ci-cd/reporters.md).

## A Solid Default Config

```ts
// vitest.config.ts
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    expect: { requireAssertions: true },
  },
})
```

Run once, outside watch mode, with `npx vitest run`. `vitest` on its own starts watch mode unless it detects CI, a non-TTY stdin, or an AI coding agent. `vitest run` does not type-check, so run `tsc --noEmit` separately.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Separate `vitest.config.ts` without merging `vite.config` | App plugins and aliases silently missing in tests | `mergeConfig(viteConfig, defineConfig({...}))` |
| `include: ['src/**/*.test.ts']` when you meant to extend the default | Replaces the defaults, so other matching files are dropped | Spread `configDefaults.include`/`exclude` |
| Relying on a config in a parent directory | Not found in 5.x | `--config path`, or run from the root |
| `globals: true` without `vitest/globals` types | TypeScript errors on `describe`/`expect` | Add `"types": ["vitest/globals"]` |
| Asserting on calls made in `beforeAll` or a setup file | Cleared by default `clearMocks` | Assert inside the test, or `clearMocks: false` |
| `retry: { condition: (e) => ... }` in config | Functions can't be serialized to workers | RegExp in config, functions in test files |
| Heavy setup in `setupFiles` | Runs for every test file | `globalSetup` + `provide` |
| Raising `testTimeout` globally for one slow test | Hides hangs | Per-test `{ timeout }` or a tag with `timeout` |
| Committing `.vitest/` | Generated noise | Add it to `.gitignore` |

## Related References

- **Multiple configs / monorepos**: [projects.md](projects.md)
- **Hooks, setupFiles, globalSetup in depth**: [fixtures-hooks.md](fixtures-hooks.md)
- **Tags with shared timeouts and retries**: [annotations-filtering.md](annotations-filtering.md)
- **Pools, isolation, speed**: [performance.md](../infrastructure-ci-cd/performance.md)
- **Coverage config**: [coverage.md](../infrastructure-ci-cd/coverage.md)
- **Migrating config from Jest / 4.x**: [migration.md](../architecture/migration.md)
