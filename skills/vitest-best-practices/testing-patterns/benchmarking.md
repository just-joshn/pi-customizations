# Benchmarking

## Table of Contents

1. [The 5.x API in One Glance](#the-5x-api-in-one-glance)
2. [Files and Running](#files-and-running)
3. [Defining and Running a Benchmark](#defining-and-running-a-benchmark)
4. [Comparing Implementations](#comparing-implementations)
5. [Options](#options)
6. [Asserting Performance](#asserting-performance)
7. [Baselines: writeResult and bench.from](#baselines-writeresult-and-benchfrom)
8. [Across Projects and Browsers](#across-projects-and-browsers)
9. [Getting Trustworthy Numbers](#getting-trustworthy-numbers)
10. [Migrating from the 1.x–4.x bench API](#migrating-from-the-1x4x-bench-api)

## The 5.x API in One Glance

**Version note (5.0):** the benchmarking API was rewritten. `bench` is **no longer imported from `vitest`**. It is a test-context fixture you destructure inside a regular `test()`. Anything you remember or find online that does `import { bench } from 'vitest'` and calls `bench()` at module or `describe` level is the 1.x–4.x API and does not work in 5.x. The feature is marked experimental.

```ts
// src/parse.bench.ts
import { expect, test } from 'vitest'
import { fastParse } from './fast-parse'

test('fastParse vs JSON.parse', async ({ bench }) => {
  const input = '{"key":"value","nested":{"a":1}}'

  const result = await bench.compare(
    bench('JSON.parse', () => JSON.parse(input)),
    bench('fastParse', () => fastParse(input)),
  )

  expect(result.get('fastParse')).toBeFasterThan(result.get('JSON.parse'), { delta: 0.1 })
})
```

Because benchmarks are ordinary tests, they get fixtures, hooks, `retry`, `-t` filtering, `test.skip`/`test.only`, and assertions.

## Files and Running

- The `bench` fixture exists only in files matching `benchmark.include` (default `**/*.{bench,benchmark}.?(c|m)[jt]s?(x)`). Using `{ bench }` in a regular `*.test.ts` file **throws**. File name decides; rename `parser.test.ts` → `parser.bench.ts` to move it.
- Benchmark files run in their own dedicated project, separate from regular tests.

| Command / config | What runs |
| --- | --- |
| `vitest` (default) | Regular tests only. Benchmark files are ignored |
| `vitest bench` | Benchmarks only (enables `benchmark.enabled` for the run) |
| `vitest` with `benchmark.enabled: true` | Regular tests first, then benchmarks in a separate group |

```bash
npx vitest bench                  # all benchmarks
npx vitest bench parser           # files matching "parser"
npx vitest bench -t JSON          # tests whose name matches "JSON"
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    benchmark: {
      // enabled: true, // run benchmarks after tests in plain `vitest` (e.g. one CI command)
      include: ['bench/**/*.bench.ts'],
    },
  },
})
```

Output: after each test, Vitest prints a table (ops/sec, mean, percentiles). Benchmark results are part of the `default` and `json` reporters; capture them with `--reporter=json --outputFile=bench.json` (the JSON reporter adds a `benchmarks` field to each test case).

## Defining and Running a Benchmark

`bench(name, fn)` only **registers** a benchmark. Call `.run()` (or pass it to `bench.compare()`) to execute it, and await the result.

```ts
import { expect, test } from 'vitest'
import { parse } from './parser'

test('parse throughput', async ({ bench }) => {
  const result = await bench('parse', () => {
    sink(parse(largeInput)) // consume the result
  }).run()

  expect(result.throughput.mean).toBeGreaterThan(10_000)
})
```

A registration that is never run or compared does nothing. Always `await` the `.run()` / `bench.compare()` promise.

## Comparing Implementations

`bench.compare(...registrations, options?)` runs the benchmarks with **interleaved** iterations to reduce bias from CPU throttling and GC, prints one comparison table, and returns a store keyed by benchmark name.

```ts
import { test } from 'vitest'

test('sorting algorithms', async ({ bench }) => {
  const original = Array.from({ length: 10_000 }, () => Math.random())
  let data: number[] = []

  await bench.compare(
    bench('Array#sort', { beforeEach: () => { data = [...original] } }, () => {
      data.sort((a, b) => a - b)
    }),
    bench('radixSort', { beforeEach: () => { data = [...original] } }, () => {
      radixSort(data)
    }),
  )
})
```

`result.get(name)` is typed from the names you registered, so a typo in `get('...')` is a type error.

## Options

| Where | Argument | Examples |
| --- | --- | --- |
| Per benchmark | `bench(name, options, fn)` — **second** argument | `beforeEach`, `afterEach`, `beforeAll`, `afterAll` (Tinybench `FnOptions`), plus Vitest's `writeResult`, `perProject` |
| Per run | last argument of `bench.compare(...)` or `registration.run(options)` | `iterations`, `time` (Tinybench `BenchOptions`) |

```ts
await bench.compare(
  bench('lib1', () => lib1()),
  bench('lib2', () => lib2()),
  { iterations: 100, time: 1_000 },
)
```

Per-benchmark hooks keep setup (allocation, cache clearing) out of the measured function. One example in the 5.1 benchmarking guide passes options as the **third** argument; the published type signature is `bench(name, fn)` or `bench(name, options, fn)`. Use the second-argument form.

## Asserting Performance

`toBeFasterThan` / `toBeSlowerThan` compare two results. Always set `delta` (minimum relative difference) and consider `retry`; benchmark numbers are noisy.

```ts
import { expect, test } from 'vitest'

test('cache makes lookups faster', { retry: 3 }, async ({ bench }) => {
  const result = await bench.compare(
    bench('cached', () => cachedLookup(key)),
    bench('uncached', () => uncachedLookup(key)),
  )

  expect(result.get('cached')).toBeFasterThan(result.get('uncached'), { delta: 0.2 }) // ≥ 20% faster
  expect(result.get('uncached')).toBeSlowerThan(result.get('cached'))
})
```

Absolute thresholds (`result.throughput.mean > N`) depend on the machine. Use them only where the environment is fixed (a dedicated CI runner), and prefer relative comparisons otherwise.

## Baselines: writeResult and bench.from

`writeResult` saves a result as JSON (path relative to the project root) on every successful run. `bench.from(name, source)` reads a stored result back without running anything; `source` is a path or a function returning the data (sync or async).

```ts
import { expect, test } from 'vitest'

test('no regression against the committed baseline', async ({ bench }) => {
  if (import.meta.env.VITE_WRITE_BENCH) {
    await bench('baseline', { writeResult: './benchmarks/parse.json' }, () => parse(input)).run()
    return
  }

  const result = await bench.compare(
    bench('current', () => parse(input)),
    bench.from('baseline', './benchmarks/parse.json'),
  )
  // fails only if current is at least 10% slower than the baseline
  expect(result.get('current')).not.toBeSlowerThan(result.get('baseline'), { delta: 0.1 })
})
```

```bash
VITE_WRITE_BENCH=1 npx vitest bench   # refresh the baseline (on the reference machine)
npx vitest bench                      # compare against it
```

- The file is overwritten on every successful run; if the function throws, nothing is written.
- Results vary heavily between machines. Generate committed baselines in **one** environment (usually CI) and don't regenerate locally.
- `bench.from()` lets you keep historical versions (`parse.v1.json`, `parse.v2.json`) after deleting the old implementation.

## Across Projects and Browsers

With multiple projects (runtimes, browser instances), `perProject: true` also collects that benchmark into one cross-project table at the end of the run. Use `${projectName}` in `writeResult`/`bench.from` paths to keep one artifact per project.

```ts
test('parse across browsers', async ({ bench }) => {
  await bench(
    'parse',
    { perProject: true, writeResult: './benchmarks/parse.${projectName}.json' },
    () => parse(input),
  ).run()
})
```

## Getting Trustworthy Numbers

Vitest already runs tests inside a benchmark file sequentially and runs benchmark files one at a time. The rest is on you:

- **Consume results.** If the function's output is unused, the JIT may eliminate the work. Pass results to a sink or assert on them.
- **Module runner getters.** In Node, Vite's module runner turns imported bindings into getters, which can dominate hot loops. Copy the import to a local constant (`const _parse = parse`) outside the benchmark, benchmark the built package instead of source, or disable `experimental.viteModuleRunner` for the benchmark project. Vitest warns on excessive getter calls (`benchmark.suppressExportGetterWarnings` silences it). Browser Mode is unaffected.
- **Stable shapes.** Mixed object shapes cause V8 deoptimizations mid-run. Keep input types consistent.
- **Allocate outside the measured function.** Use `beforeEach` in bench options to prepare data.
- **Browser timers are coarse.** Increase `iterations` for very fast operations.
- **Compare like with like.** Benchmark the same kind of artifact (built vs source) for every implementation.
- Close CPU-heavy apps; don't run benchmarks in parallel with other jobs.

## Migrating from the 1.x–4.x bench API

| 1.x–4.x | 5.x |
| --- | --- |
| `import { bench } from 'vitest'`; `bench('x', fn)` at top level or in `describe` | `test('x', async ({ bench }) => { await bench('x', fn).run() })` |
| Several `bench()` calls in one `describe` to compare | `await bench.compare(bench('a', fa), bench('b', fb))` |
| `bench.skip` / `bench.only` / `bench.todo` | `test.skip` / `test.only` / `test.todo` on the surrounding test |
| `bench(name, fn, { iterations, time })` | `bench.compare(..., { iterations, time })` or `.run({ iterations, time })` |
| `benchmark.reporters`, `benchmark.outputFile` | Top-level `reporters`; results are in `default` and `json` reporters |
| `benchmark.outputJson` / `--outputJson` | `--reporter=json --outputFile=<path>` |
| `benchmark.compare` / `--compare` | `writeResult` + `bench.from()` inside `bench.compare()` |

Custom engines: `benchmark.provider` points to a module whose default export implements `BenchmarkProvider` (see the Vitest "Custom Benchmark Provider" guide).

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `import { bench } from 'vitest'` | Removed in 5.0 | Destructure `{ bench }` from the test context |
| `{ bench }` in a `*.test.ts` file | Throws; fixture only exists in benchmark files | Name the file `*.bench.ts` (or adjust `benchmark.include`) |
| `bench('x', fn)` without `.run()` / `compare` | Registers but never runs | `await bench('x', fn).run()` |
| Not awaiting `.run()` / `bench.compare()` | Results and assertions are lost | `await` every benchmark call |
| `toBeFasterThan` with no `delta` or `retry` | Flaky on noise | `{ delta: 0.1 }` and `{ retry: 3 }` |
| Absolute ops/sec thresholds on shared CI | Machine-dependent failures | Relative comparisons or a fixed runner |
| Unused results in the benchmark body | Dead-code elimination fakes speed | Consume the result |
| Calling imported functions in hot loops (Node) | Module-runner getter overhead dominates | Local alias, built artifact, or disable the module runner |
| Regenerating `writeResult` baselines on laptops | Baseline drifts with hardware | Generate in one controlled environment |
| Running benchmarks on every `vitest` save | Slow and noisy dev loop | Keep the default (benchmarks off); run `vitest bench` explicitly |

## Related References

- **Test context and fixtures**: [fixtures-hooks.md](../core/fixtures-hooks.md)
- **skip / only / filtering**: [annotations-filtering.md](../core/annotations-filtering.md)
- **Projects (per-runtime/browser runs)**: [projects.md](../core/projects.md)
- **Reporters and JSON output**: [reporters.md](../infrastructure-ci-cd/reporters.md)
- **Suite speed (not micro-benchmarks)**: [performance.md](../infrastructure-ci-cd/performance.md)
- **Upgrading from 4.x**: [migration.md](../architecture/migration.md)
