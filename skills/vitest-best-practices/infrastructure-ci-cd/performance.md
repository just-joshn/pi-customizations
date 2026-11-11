# Performance and Parallelism

## Table of Contents

1. [Profile Before Tuning](#profile-before-tuning)
2. [Pools](#pools)
3. [Isolation](#isolation)
4. [File Parallelism and Workers](#file-parallelism-and-workers)
5. [Test Concurrency Within a File](#test-concurrency-within-a-file)
6. [DOM Environment Cost](#dom-environment-cost)
7. [Import and Transform Cost](#import-and-transform-cost)
8. [Caches and Shared Servers](#caches-and-shared-servers)
9. [Profiling Workers and Memory](#profiling-workers-and-memory)

## Profile Before Tuning

Read the `Duration` line first. Its phases point to the option that matters:

```
Duration  3.76s (environment 79%, import 13%, transform 6%, tests 1%, setup 1%)
```

| Phase dominating | Meaning                                         | Lever                                                    |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------- |
| `environment`    | jsdom/happy-dom created per file                | `vmThreads`/`vmForks`, `isolate: false`, `happy-dom`     |
| `import`         | Same module graph re-evaluated per file (barrels) | `isolate: false`, direct imports, `deps.optimizer`     |
| `transform`      | Vite transforms                                 | `fsModuleCache` (on by default), fewer barrel imports    |
| `setup`          | `setupFiles` are heavy                          | Trim what `setupFiles` import and do per file             |
| `worker`         | Spawning a worker per file                      | `isolate: false`                                         |
| `tests`          | Your test code                                  | Configuration won't help; fix slow tests                 |

Percentages are relative to the sum of tracked phases, which run in parallel. They are not wall-clock time.

Two built-in tools do the analysis for you:

- **Performance hints** (`experimental.diagnostics`, on by default in 5.x) print after the summary when a config change would help a lot. They never suggest changing an option you set explicitly.
- **`vitest doctor`** reruns the suite under candidate configs (`pool`, `isolate: false`, vm pools, `happy-dom`, lower `maxWorkers`, `fsModuleCache`). It reports measured deltas, and it validates `isolate: false` by running twice with shuffled file order.

```bash
npx vitest doctor
npx vitest run --slowTestThreshold=1000   # flag tests slower than 1s (default 300ms)
```

## Pools

| Pool        | Mechanism                         | Use when                                                              |
| ----------- | --------------------------------- | --------------------------------------------------------------------- |
| `forks` (default) | `child_process` per worker  | Default. Safest for native modules (Prisma, bcrypt, canvas) and `process.chdir()` |
| `threads`   | `worker_threads`                  | Large suites without native addons; slightly faster IPC               |
| `vmThreads` | VM context per file in threads    | DOM-heavy suites where per-file environment cost dominates            |
| `vmForks`   | VM context per file in processes  | Same as `vmThreads`, but cheaper worker recycling on big suites       |

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'threads',
  },
})
```

Caveats for `threads`: `process.chdir()` is unavailable, and changing `process.env.TZ` does not change the worker's time zone.

Caveats for the vm pools:

- Errors from Node built-ins fail `instanceof Error`. Objects from Node APIs or the environment (`response.json()`, `structuredClone()`, `path.parse()`) fail `toStrictEqual` against literals because their prototypes differ.
- Memory leaks by design. Workers recycle at [`vmMemoryLimit`](#profiling-workers-and-memory). Recycling is expensive in `vmThreads`, so prefer `vmForks` on large suites.
- `isolate` has no effect. vm pools always isolate per file.

## Isolation

By default (`isolate: true`), every test file gets a fresh worker and module graph. That's safe, and it costs a worker spawn, an environment setup, and a re-import per file. Disabling isolation reuses workers across files:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          isolate: false,
          exclude: ['**/*.integration.{test,spec}.ts'],
        },
      },
      {
        test: {
          name: 'integration', // stays isolated
          include: ['**/*.integration.{test,spec}.ts'],
        },
      },
    ],
  },
})
```

A file is safe to run without isolation only if it does **not**:

- mutate module-level state (caches, counters, top-level `let`)
- call `vi.stubGlobal` / `vi.stubEnv` without restoring
- patch prototypes or register listeners on `process`
- rely on a fresh module instance for `vi.mock` factories

Verify by shuffling. If two shuffled runs disagree, a test depends on order:

```bash
vitest run --sequence.shuffle --project=unit
vitest run --sequence.shuffle --project=unit
```

**Version note:** 5.1 made `isolate: false` cheaper. Workers now cache setup-file resolution and warm modules across files.

## File Parallelism and Workers

Files run in parallel across workers. `maxWorkers` defaults to all available parallelism in `run` mode and half in watch mode. It accepts a number or a percentage:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    maxWorkers: process.env.CI ? '50%' : undefined,
  },
})
```

More workers is not always faster. Every worker sends transform requests through the single main-thread Vite server. `vitest doctor` tests lower values. On many-core machines, sharding across processes spreads that load (see [ci.md](ci.md#sharding-and-merging-reports)).

`fileParallelism: false` (or `--no-file-parallelism`) forces `maxWorkers` to 1. Use it only when files share a resource that can't handle concurrent access, such as a single database. A better fix is a per-worker resource keyed by `VITEST_POOL_ID`, which is 1-based in 5.x. See [integration-testing.md](../testing-patterns/integration-testing.md).

## Test Concurrency Within a File

Tests inside a file run sequentially. `test.concurrent` and `describe.concurrent` run them with `Promise.all` **in the same worker**. That only helps when tests wait on I/O or timers. CPU-bound tests still run one at a time.

```ts
import { describe, expect, test } from 'vitest'

describe.concurrent('user API', () => {
  test('fetches profile', async ({ expect }) => {
    expect(await fetchUser(1)).toMatchObject({ id: 1 })
  })

  test('fetches posts', async ({ expect }) => {
    expect(await fetchPosts(1)).toHaveLength(3)
  })

  test('mutates shared fixture', { concurrent: false }, async () => {
    // opt out of inherited concurrency
  })
})
```

- Use the context `expect` in concurrent tests so assertions and snapshots go to the right test.
- `maxConcurrency` (default 5) bounds how many run at once. `sequence.concurrent: true` makes all tests concurrent.
- **Version note:** `test.sequential` and `describe.sequential` were removed in 5.0. Use `{ concurrent: false }`.

## DOM Environment Cost

jsdom costs about 200-500ms to import per file and happy-dom about 90-200ms, plus window construction. Under the default isolating pool, you pay that for every file.

| Config                                | Environment created | Trade-off                                       |
| ------------------------------------- | ------------------- | ----------------------------------------------- |
| `forks`/`threads` + `isolate: true`   | once per file       | Safest, slowest                                 |
| `vmThreads` / `vmForks`               | once per worker     | Fresh `window` per file; vm-realm caveats       |
| `isolate: false`                      | once per worker     | Files share `window` and module state           |

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom', // cheaper than jsdom; verify layout/navigation-dependent tests
    pool: 'vmThreads',
  },
})
```

Also split pure-logic tests into a `node` project so they don't pay for a DOM at all. See [projects.md](../core/projects.md).

## Import and Transform Cost

Find slow imports:

```bash
vitest run --experimental.importDurations.print
```

Fixes, in order of preference:

1. **Import the specific module, not the barrel.** For example, change `import { formatter } from '../src/utils'` to `import { formatter } from '../src/utils/formatters'`. Use the library's sub-path entry points too (`date-fns/format`).
2. **Bundle heavy dependencies** with the optimizer. Use `ssr` for `node`/`edge` environments and `client` for `jsdom`/`happy-dom`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    deps: {
      optimizer: {
        ssr: { enabled: true, include: ['date-fns'] },
      },
    },
  },
})
```

3. **Limit file discovery** with `test.dir` when the root contains large unrelated folders.

## Caches and Shared Servers

- **`fsModuleCache`** (stable and **on by default** in 5.0; previously `experimental.fsModuleCache`) persists transformed modules in `node_modules/.vitest-cache`. It helps most when you rerun a few files that import a large graph. Debug it with `DEBUG=vitest:cache:fs`, and reset it with `vitest --clearCache`. It does not apply to Browser Mode. A plugin that reads files outside the module can produce stale results. Such a plugin should define a cache key generator.
- **`NODE_COMPILE_CACHE=<dir>`** caches V8 bytecode for Vitest and externalized deps. It's worth it only when the directory persists. It is disabled in workers when `v8` coverage is on.
- **`sharedViteServer`** (default `true`, new in 5.0) lets inline projects that don't change Vite config share one server, so shared files transform once. A project gets its own server if it sets `plugins`, `resolve`, `alias`, `browser`, `css`, `deps.optimizer`, `deps.moduleDirectories`, `mode`, or `root`. Hoist repeated `plugins` to the root config to keep sharing. Inspect the decisions with `DEBUG=vitest:projects`.

## Profiling Workers and Memory

CPU and heap profiles of the test runner. Run files serially so profiles are readable:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    execArgv: ['--cpu-prof', '--cpu-prof-dir=test-runner-profile', '--heap-prof', '--heap-prof-dir=test-runner-profile'],
  },
})
```

- `--prof` does not work with `pool: 'threads'`.
- Profile the main process (Vite plugins, `globalSetup`): `node --cpu-prof --cpu-prof-dir=main-profile ./node_modules/vitest/vitest.mjs --run`.
- Find memory leaks: `vitest run --logHeapUsage` prints heap usage after each test.
- Check vm pools: set `vmMemoryLimit` explicitly (for example `'512MB'` or `0.25`). The default splits system memory by worker count. Percentages are unreliable on CircleCI Linux.
- Slow coverage: `DEBUG=vitest:coverage vitest run --coverage`. See [coverage.md](coverage.md).

## Anti-Patterns to Avoid

| Anti-Pattern                                         | Problem                                                       | Solution                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Tuning without reading the `Duration` breakdown      | Changes the wrong knob                                        | Profile first; run `vitest doctor`                          |
| `isolate: false` across the whole suite blindly      | Order-dependent failures from leaked module or global state   | Per-project opt-out; verify with `--sequence.shuffle`       |
| `fileParallelism: false` to dodge a shared DB        | Serializes the whole suite                                    | Per-worker DB keyed by `VITEST_POOL_ID`                     |
| `test.concurrent` on CPU-bound tests                 | No speedup; same thread                                       | Only use it for I/O-bound tests                             |
| Global `expect` inside concurrent tests              | Assertions or snapshots attributed to the wrong test          | Destructure `expect` from the test context                  |
| `threads` with Prisma/bcrypt/canvas                  | Segfaults                                                     | Keep `forks`                                                |
| `vmThreads` on a huge suite that keeps recycling     | GC-heavy thread teardown slows all workers                    | `vmForks`, or tune `vmMemoryLimit`                          |
| `toStrictEqual` on `response.json()` in vm pools     | Cross-realm prototypes fail equality                          | `toEqual`, or use `forks`/`threads`                         |
| Importing from barrel files in every test            | Huge `import`/`transform` phases                              | Import specific modules; `deps.optimizer`                   |
| Maxing `maxWorkers` on many-core CI                  | Main-thread Vite server becomes the bottleneck                | Lower workers or shard across processes                     |

## Related References

- **CI sharding and caching**: [ci.md](ci.md)
- **Projects for per-type settings**: [projects.md](../core/projects.md)
- **Order-dependent failures**: [flaky-tests.md](../debugging/flaky-tests.md)
- **DOM environments**: [dom-environments.md](../testing-patterns/dom-environments.md)
- **Coverage overhead**: [coverage.md](coverage.md)
- **Configuration basics**: [configuration.md](../core/configuration.md)
