# Reporters

## Table of Contents

1. [Choosing Reporters](#choosing-reporters)
2. [Default Selection and Combining](#default-selection-and-combining)
3. [Output Files and the .vitest Directory](#output-files-and-the-vitest-directory)
4. [Terminal Reporters](#terminal-reporters)
5. [Machine-Readable Reporters](#machine-readable-reporters)
6. [HTML Reporter](#html-reporter)
7. [GitHub Actions Reporter](#github-actions-reporter)
8. [Blob Reporter](#blob-reporter)
9. [Custom Reporters](#custom-reporters)

## Choosing Reporters

Built-in names: `default`, `verbose`, `tree`, `dot`, `minimal` (alias `agent`), `junit`, `json`, `html`, `tap`, `tap-flat`, `hanging-process`, `github-actions`, `blob`.

| Need                                         | Reporter                                       |
| -------------------------------------------- | ---------------------------------------------- |
| Local development                            | `default`                                      |
| See every test name as it finishes           | `verbose` (flat lines) or `tree` (nested)      |
| Huge suite, quiet logs                       | `dot`                                          |
| AI agent / token-limited output              | `minimal` (auto-selected when an agent is detected) |
| CI test-results UI (Jenkins, GitLab, Azure)  | `junit`                                        |
| Scripts and dashboards                       | `json`                                         |
| Browsable report artifact                    | `html`                                         |
| PR annotations and job summary on GitHub     | `github-actions` (auto-added on GitHub Actions) |
| Sharded or multi-OS runs                     | `blob`, then `--merge-reports`                 |
| Vitest won't exit                            | `hanging-process`, alongside another reporter  |

Coverage output is configured separately, with `coverage.reporter`. See [coverage.md](coverage.md).

## Default Selection and Combining

When `reporters` is unset, Vitest uses `default`. It uses `minimal` instead when an AI coding agent is detected, and adds `github-actions` when `GITHUB_ACTIONS === 'true'`. **Configuring `reporters` replaces that list.** Spread `configDefaults.reporters` to keep the defaults:

```ts
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: [
      ...configDefaults.reporters,
      ['junit', { suiteName: 'unit' }],
      ...(process.env.CI ? ['html'] : []),
    ],
  },
})
```

```bash
vitest run --reporter=dot --reporter=junit   # repeat the flag for several reporters
```

Pass options with a `[name, options]` tuple. `reporters` is a root-level option and is not allowed inside a project config.

## Output Files and the .vitest Directory

**Version note (5.0):** all reporter artifacts default to one `.vitest/` directory at the project root. Add `.vitest` to `.gitignore` and upload it in CI.

| Reporter / artifact     | 5.x default                     | 4.x default                     |
| ----------------------- | ------------------------------- | ------------------------------- |
| `json`                  | `.vitest/json/output.json`      | stdout                          |
| `junit`                 | `.vitest/junit/output.xml`      | stdout                          |
| `html`                  | `.vitest/index.html` (`outputDir`) | `html/index.html` (`outputFile`) |
| `blob`                  | `.vitest/blob/blob-*.json`      | `.vitest-reports/`              |
| attachments             | `.vitest/attachments/`          | `.vitest-attachements/`         |

Override paths with top-level `outputFile` (one string, or an object keyed by reporter), or with a reporter's own `outputFile`, which wins:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: ['default', 'junit', ['json', { outputFile: './reports/results.json' }]],
    outputFile: {
      junit: './reports/junit.xml',
    },
  },
})
```

To pipe JSON or JUnit to stdout as in 4.x, set `stdout: true`. It is ignored when `outputFile` is set. Other writes to stdout, such as test logs or global setup output, can then corrupt the report. Prefer reading the file:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: [['json', { stdout: true }]],
  },
})
```

## Terminal Reporters

- **`default`**: live summary of running files. It prints the full tree when only one file runs or a file has failures. Disable the bottom summary with `['default', { summary: false }]`. The `Duration` line breaks time into phases (see [performance.md](performance.md)).
- **`verbose`**: one line per finished test, with errors printed immediately. It is the only terminal reporter that shows test annotations (`context.annotate`) on passing tests. Add `--includeTaskLocation` for `file:line`.
- **`tree`**: like `default`, but lists every test after its suite finishes. Tests slower than `slowTestThreshold` (default 300ms) are highlighted.
- **`dot`**: one dot per test, with details only for failures.
- **`minimal` / `agent`**: failures and their errors only. Passing-test logs and the summary are suppressed.

**Version note (5.1):** a test that fails across retries prints one header that lists the attempts, for example `(initial run, 1st retry, 2nd retry)`.

## Machine-Readable Reporters

**JUnit** options include `suiteName`, `suiteNameTemplate`, `classnameTemplate`, `titleTemplate`, `ancestorSeparator`, `addFileAttribute`, `includeConsoleOutput`, and `stackTrace`. Templates accept placeholders or functions. For jest-junit-compatible naming:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: [
      ['junit', {
        suiteNameTemplate: '{title}',
        classnameTemplate: '{classname}',
        titleTemplate: '{title}',
        addFileAttribute: true,
      }],
    ],
  },
})
```

`{filename}` is the **root-relative path**. In jest-junit it is the bare name, so use `{basename}` for that.

**JSON** is Jest `--json` compatible. It includes `coverageMap` when coverage is on, and a `benchmarks` field when there are benchmarks. Trim the per-test `meta` with `filterMeta`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: [['json', { filterMeta: (key) => key !== 'internalField' }]],
  },
})
```

**TAP** (`tap` nested, `tap-flat` flat) is for TAP consumers.

## HTML Reporter

The HTML reporter is a static, read-only Vitest UI. It requires the `@vitest/ui` package, and Vitest prompts to install it. Preview it with `npx vite preview --outDir .vitest`.

```ts
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: [...configDefaults.reporters, ['html', { singleFile: true }]],
  },
})
```

- `outputDir` sets the directory (default `.vitest`). The `outputFile` option from 4.x is gone.
- `singleFile: true` (5.0) inlines assets and attachments into one `index.html` that opens over `file://`. That file can get very large, and coverage HTML is not inlined.
- The report includes Browser Mode trace view and the coverage HTML.

## GitHub Actions Reporter

Auto-enabled on GitHub Actions unless you replace `reporters`. It emits failure annotations, inlines test annotations (`displayAnnotations: false` to disable), and writes a job summary with flaky (retried) tests and source permalinks.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: process.env.GITHUB_ACTIONS === 'true'
      ? [
          'default',
          ['github-actions', {
            // map container paths back to the checkout for annotations
            onWritePath: (path) => path.replace(/^\/app\//, `${process.env.GITHUB_WORKSPACE}/`),
            jobSummary: { title: 'Unit tests' }, // distinguish multiple Vitest steps
          }],
        ]
      : ['default'],
  },
})
```

Disable the summary with `jobSummary: { enabled: false }`. Permalinks use `GITHUB_REPOSITORY`, `GITHUB_SHA`, and `GITHUB_WORKSPACE`. Override them with `jobSummary.fileLinks` when running in a container.

## Blob Reporter

The blob reporter stores raw results for `--merge-reports`. It doesn't work in watch mode.

```bash
VITEST_BLOB_LABEL=linux vitest run --reporter=blob --shard=1/2
vitest --merge-reports --reporter=junit --reporter=default
vitest --merge-reports=path/to/blobs   # custom folder
```

The label can also come from `['blob', { label: 'linux' }]`, which takes precedence over the variable. Blobs don't contain file-based attachments, so carry `attachmentsDir` over separately. In 5.x, merging also works for non-sharded runs across environments. See [ci.md](ci.md#sharding-and-merging-reports).

## Custom Reporters

Implement the `Reporter` interface from `vitest/node`. Prefer the modern lifecycle hooks: `onInit`, `onTestRunStart`, `onTestModuleQueued`, `onTestModuleCollected`, `onTestModuleStart`, `onTestModuleEnd`, `onTestCaseReady`, `onTestCaseResult`, `onTestRunEnd`, and `onCoverage`.

```ts
import type { Reporter, TestCase, TestModule, Vitest } from 'vitest/node'

export default class FlakyReporter implements Reporter {
  private vitest!: Vitest

  onInit(vitest: Vitest) {
    this.vitest = vitest
  }

  onTestCaseResult(testCase: TestCase) {
    // 5.1: per-attempt results
    const attempts = testCase.attempts()
    if (testCase.result().state === 'passed' && attempts.length > 1) {
      console.warn(`${testCase.fullName} passed after ${attempts.length} attempts`)
    }
  }

  async onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    // 5.0: write into .vitest/<scope>/ instead of inventing a path
    const report = this.vitest.createReport('flaky-reporter')
    await report.writeFile('modules.txt', testModules.map(m => m.moduleId).join('\n'))
  }
}
```

```ts
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: [...configDefaults.reporters, './reporters/flaky-reporter.ts'],
  },
})
```

- You can extend a built-in reporter (`DefaultReporter`, `VerboseReporter`, `JUnitReporter`, and so on from `vitest/node`). Their internals can change in minor versions.
- Custom artifacts belong in `.vitest/<your-scope>/`. Never delete `.vitest` itself.
- **Version note (5.0):** `vitest/reporters` was removed. Import from `vitest/node`. `TestModule.diagnostic()` exposes a 1-based `workerId` and a new `concurrencyId`.

## Anti-Patterns to Avoid

| Anti-Pattern                                    | Problem                                                    | Solution                                                 |
| ----------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| `reporters: ['junit']` alone                    | Loses terminal output and GitHub annotations               | `[...configDefaults.reporters, 'junit']`                 |
| `vitest --reporter=json \| jq` on 5.x           | JSON now goes to `.vitest/json/output.json`                | Read the file, or set `stdout: true`                     |
| `['html', { outputFile }]`                      | Removed in 5.x                                             | `['html', { outputDir }]`                                |
| Uploading `html/` or `.vitest-reports/`         | Old 4.x paths; artifacts are missing                       | Upload `.vitest/`                                        |
| Expecting `{filename}` to be a bare name in JUnit | It's the root-relative path                              | `{basename}`                                             |
| Custom reporter writing to arbitrary folders    | More `.gitignore` entries; collisions                      | `vitest.createReport(scope)`                             |
| Importing from `vitest/reporters`               | Entry point removed in 5.0                                 | `vitest/node`                                            |
| `hanging-process` left on permanently           | Resource-intensive                                         | Only use it while debugging a run that won't exit        |
| Setting `reporters` in a project config         | Root-only option                                           | Configure it in the root config                          |

## Related References

- **Sharding and CI artifacts**: [ci.md](ci.md)
- **Coverage reporters**: [coverage.md](coverage.md)
- **Duration breakdown and slow tests**: [performance.md](performance.md)
- **Debugging failures and annotations**: [debugging.md](../debugging/debugging.md)
- **Retries and flaky tests**: [flaky-tests.md](../debugging/flaky-tests.md)
