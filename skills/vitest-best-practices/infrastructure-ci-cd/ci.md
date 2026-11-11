# Running Vitest in CI

## Table of Contents

1. [CI Behavior Vitest Switches On Automatically](#ci-behavior-vitest-switches-on-automatically)
2. [Basic GitHub Actions Workflow](#basic-github-actions-workflow)
3. [Sharding and Merging Reports](#sharding-and-merging-reports)
4. [Caching Between CI Runs](#caching-between-ci-runs)
5. [Annotations, Job Summary, and Artifacts](#annotations-job-summary-and-artifacts)
6. [Browser Mode in CI](#browser-mode-in-ci)
7. [Running Only Affected Tests](#running-only-affected-tests)
8. [Failing Fast](#failing-fast)

## CI Behavior Vitest Switches On Automatically

Vitest detects CI with the `std-env` package (in practice, a truthy `process.env.CI`). Several defaults change:

| Behavior               | Local default                       | CI default                                                       |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `vitest` (no command)  | watch mode                          | single run (also when stdin is not a TTY)                        |
| `allowOnly`            | `true`                              | `false`: a `.only` left in the code fails the run                |
| Snapshots (`update`)   | new snapshots are written           | nothing is written; mismatched, missing, or obsolete snapshots fail |
| `browser.headless`     | `false`                             | `true`                                                           |
| Reporters              | `default`                           | `default`, plus `github-actions` when `GITHUB_ACTIONS === 'true'` |

Always call `vitest run` explicitly in CI scripts. Don't rely on TTY detection:

```json
{
  "scripts": {
    "test": "vitest",
    "test:ci": "vitest run"
  }
}
```

A missing snapshot fails in CI by design. Commit snapshots from a local run. Don't pass `-u` in CI to make the job pass.

## Basic GitHub Actions Workflow

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24        # Vitest 5 requires Node >= 22.12
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit     # vitest run does not type-check
      - run: npx vitest run
```

**Version note:** Vitest 5 needs Node >= 22.12.0 and Vite >= 6.4.0. `vite` is now a peer dependency. Yarn users must list it in `package.json` themselves.

Use `--retry` only to keep CI moving while you fix a known flake. The GitHub Actions job summary lists tests that needed a retry, so they stay visible:

```bash
npx vitest run --retry=2
```

## Sharding and Merging Reports

`--shard=<index>/<count>` splits **test files** (not test cases) across machines. Pair it with the `blob` reporter, then merge the blobs in a final job. `--shard` cannot be combined with watch mode.

```bash
vitest run --reporter=blob --shard=1/3   # machine 1
vitest run --reporter=blob --shard=2/3   # machine 2
vitest run --reporter=blob --shard=3/3   # machine 3
vitest run --merge-reports               # reads .vitest/blob/ by default
```

**Version note:** in 5.x, blobs go to `.vitest/blob/blob-*.json`. In 4.x they went to `.vitest-reports/`. Update artifact paths after upgrading.

The merge step accepts any reporter except `blob`, and it merges coverage too:

```bash
vitest run --shard=1/2 --reporter=blob --coverage
vitest run --shard=2/2 --reporter=blob --coverage
vitest --merge-reports --reporter=junit --coverage
```

When the same shards run on several OSes, set `VITEST_BLOB_LABEL` so that the merged report shows each environment separately. A `label` option on the blob reporter takes precedence over the variable.

```yaml
jobs:
  tests:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        shardIndex: [1, 2, 3, 4]
        shardTotal: [4]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx vitest run --reporter=blob --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
        env:
          VITEST_BLOB_LABEL: ${{ matrix.os }}
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: vitest-results-${{ matrix.os }}-${{ matrix.shardIndex }}
          path: .vitest
          include-hidden-files: true   # .vitest is a dot-directory
          retention-days: 1

  merge-reports:
    if: ${{ !cancelled() }}
    needs: [tests]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          path: .vitest
          merge-multiple: true
      - run: npx vitest run --merge-reports
```

Blob reports don't include file-based attachments. If tests write attachments, upload and restore `attachmentsDir` (default `.vitest/attachments/`) along with the blobs. Uploading all of `.vitest` as above covers both.

Sharding can also help on one machine with many cores, because a single Vite server in the main thread serves every worker:

```bash
VITEST_MAX_WORKERS=7 vitest run --reporter=blob --shard=1/4 &
VITEST_MAX_WORKERS=7 vitest run --reporter=blob --shard=2/4 &
VITEST_MAX_WORKERS=7 vitest run --reporter=blob --shard=3/4 &
VITEST_MAX_WORKERS=7 vitest run --reporter=blob --shard=4/4 &
wait
vitest run --merge-reports
```

## Caching Between CI Runs

| Cache                                  | Default location                                     | What it buys                                             |
| -------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| [`fsModuleCache`](performance.md) (on by default) | `node_modules/.vitest-cache` (`fsModuleCachePath`) | Skips re-transforming modules                             |
| Results cache (`cache`, on by default) | Vite's `cacheDir`                                    | Runs failed and slow files first; feeds `--last-failed`   |
| `NODE_COMPILE_CACHE`                   | the directory you set                                | Reuses V8 bytecode for Vitest and externalized deps       |

The module cache lives in `node_modules`, so it survives only if you cache `node_modules` or the cache path itself. To persist it separately:

```yaml
- uses: actions/cache@v4
  with:
    path: node_modules/.vitest-cache
    key: vitest-${{ runner.os }}-${{ hashFiles('package-lock.json') }}-${{ github.sha }}
    restore-keys: vitest-${{ runner.os }}-${{ hashFiles('package-lock.json') }}-
- run: npx vitest run
  env:
    NODE_COMPILE_CACHE: node_modules/.cache/node-compile-cache
```

The compile cache is only worth enabling when its directory is restored between runs. The first run pays to serialize it. Vitest turns it off in workers when the `v8` coverage provider is active. If the module cache goes stale (for example, a plugin reads files outside the transformed module), run `vitest --clearCache`.

## Annotations, Job Summary, and Artifacts

On GitHub Actions, the `github-actions` reporter is added automatically **unless you configure `reporters` yourself**. A custom list replaces the defaults, so spread `configDefaults.reporters` to keep it:

```ts
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: process.env.CI
      ? [...configDefaults.reporters, 'junit', ['html', { singleFile: true }]]
      : ['default'],
  },
})
```

The `github-actions` reporter writes failure annotations, inlines test annotations, and writes a job summary that flags tests that needed retries. When tests run in Docker, use its `onWritePath` option to remap paths. See [reporters.md](reporters.md).

Upload `.vitest/` as an artifact for the HTML report, JUnit XML, and failure screenshots:

```yaml
- uses: actions/upload-artifact@v4
  if: ${{ !cancelled() }}
  with:
    name: vitest-report
    path: .vitest/
    include-hidden-files: true
```

## Browser Mode in CI

The default `preview` provider cannot run in CI. Install `@vitest/browser-playwright` (recommended, because it runs files in parallel) or `@vitest/browser-webdriverio`. Then install the browser binaries with Playwright's own CLI:

```yaml
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: npx vitest run --project=browser
```

```ts
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      // headless defaults to true when CI is set
    },
  },
})
```

In browser mode, `maxWorkers` caps how many browser instances and pages run at once. In 5.1, trace view records failures by default (`'failure-only'`). Upload `.vitest/` to keep traces and failure screenshots (`.vitest/attachments/failure-screenshots/`). See [browser-mode.md](../testing-patterns/browser-mode.md).

## Running Only Affected Tests

| Goal                                         | Command                             |
| -------------------------------------------- | ----------------------------------- |
| Tests affected by a PR branch                | `vitest run --changed origin/main`  |
| Tests affected by uncommitted edits          | `vitest run --changed`              |
| Tests for specific source files (lint-staged) | `vitest related --run src/a.ts`     |
| Agent/edit loop, no Git needed (5.1, experimental) | `vitest run --since-last-run`  |
| Only what failed last time                   | `vitest run --last-failed`          |

`--changed` follows the import graph. Changes to `setupFiles`, `globalSetup`, the config file, or `package.json` rerun everything. Dynamic `import(path)` calls are not followed by `vitest related`. On GitHub Actions, check out with `fetch-depth: 0` so the base ref exists. Keep a full `vitest run` on the main branch, because affected-test selection can miss files that no test loaded.

`--since-last-run` and `--last-failed` depend on the results cache. They only help in CI if the cache is restored between jobs.

## Failing Fast

```bash
vitest run --bail=1          # stop after the first failing test
vitest run --passWithNoTests # don't fail a shard or filter that matches nothing
```

`bail` cancels the remaining files, and a cancelled run cannot mark files as passed in the results cache. Prefer `bail` on PR jobs for fast feedback and a full run on `main`.

## Anti-Patterns to Avoid

| Anti-Pattern                                  | Problem                                                        | Solution                                                         |
| --------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `vitest` without `run` in CI scripts          | Relies on CI/TTY detection to avoid watch mode                 | Use `vitest run`                                                 |
| `vitest run -u` in CI                         | Rewrites snapshots, so regressions pass                        | Update snapshots locally and commit them                         |
| `allowOnly: true` globally                    | A stray `.only` silently skips the other tests in that file       | Keep the default (`!CI`)                                         |
| Sharding without `--reporter=blob`            | Each shard reports alone; no merged JUnit, HTML, or coverage   | Write blobs, then `vitest run --merge-reports`                   |
| Uploading `.vitest` without `include-hidden-files` | `upload-artifact` skips dot-directories                   | Set `include-hidden-files: true`                                 |
| Custom `reporters` list on GitHub Actions     | Drops the auto-added `github-actions` annotations              | Spread `...configDefaults.reporters`                             |
| Old `.vitest-reports/` or `html/` artifact paths | 5.x writes everything under `.vitest/`                      | Point artifact steps at `.vitest/`                               |
| Only running `--changed` on every branch      | Misses dependencies it can't trace (dynamic `import(path)`, `toMatchFileSnapshot` files) | Run the full suite on `main`                                     |
| Global `retry` to hide flakes                 | Real failures pass after retry                                 | Fix the root cause; see the job summary's flaky section          |

## Related References

- **Reporters and output files**: [reporters.md](reporters.md)
- **Coverage thresholds in CI**: [coverage.md](coverage.md)
- **Workers, pools, caching**: [performance.md](performance.md)
- **Browser Mode setup**: [browser-mode.md](../testing-patterns/browser-mode.md)
- **Projects per test type**: [projects.md](../core/projects.md)
- **Flaky tests**: [flaky-tests.md](../debugging/flaky-tests.md)
