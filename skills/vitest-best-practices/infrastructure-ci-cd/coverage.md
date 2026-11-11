# Code Coverage

## Table of Contents

1. [Choosing a Provider](#choosing-a-provider)
2. [Enabling Coverage](#enabling-coverage)
3. [Include and Exclude](#include-and-exclude)
4. [Thresholds](#thresholds)
5. [Coverage Reporters](#coverage-reporters)
6. [Ignoring Code](#ignoring-code)
7. [Coverage in Browser Mode, Subprocesses, and Shards](#coverage-in-browser-mode-subprocesses-and-shards)
8. [Using Coverage Well](#using-coverage-well)

## Choosing a Provider

| Provider            | How it works                                     | Pick it when                                                              |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `v8` (default)      | V8's native coverage, AST-remapped to Istanbul format | Node or Chromium. Faster and lower memory, with Istanbul-level accuracy (since 3.2) |
| `istanbul`          | Instruments source before running                | Non-V8 runtimes (Firefox, Bun, Workers), or you want to instrument only specific files |

Install the matching package. Vitest also prompts to install it on first run:

```bash
npm i -D @vitest/coverage-v8        # or @vitest/coverage-istanbul
```

**Version note:** since 5.0, `istanbul` uses Vitest's maintained `@vitest/istanbuljs` fork. In 5.1 it instruments through Oxc instead of Babel, about 5-10x faster. `v8` remains the recommended default.

## Enabling Coverage

```json
{
  "scripts": {
    "test": "vitest",
    "coverage": "vitest run --coverage"
  }
}
```

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
})
```

When you pass coverage options with dot notation on the CLI, also pass `--coverage.enabled`. Don't use bare `--coverage` in that case:

```bash
npx vitest run --coverage.enabled --coverage.provider=istanbul --coverage.reporter=text
```

`coverage.reportsDirectory` defaults to `./coverage` and is **deleted before each run** (`coverage.clean: true`). Never point it at a directory containing anything else. By default, no report is generated when tests fail. Set `coverage.reportOnFailure: true` if CI should publish coverage anyway.

## Include and Exclude

Without `include`, the report lists only files that some test imported, so untested files are invisible and the percentage is inflated. Always set `include` to your source files:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.stories.tsx', 'src/generated/**', 'src/**/*.d.ts'],
    },
  },
})
```

Test files matched by `test.include` are excluded from coverage automatically.

**Version note (5.0):** `include`/`exclude` patterns now match **relative to the project root**, without picomatch's `contains` behavior. A pattern without a wildcard is treated as a directory:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: ['src'], // == 'src/**'. In 4.x this matched any path *containing* "src"
    },
  },
})
```

After upgrading, check that the set of reported files is what you expect. If transpiled files with source maps still show excluded sources, set `excludeAfterRemap: true`. Files outside `root` (for example sibling packages in a monorepo) need `allowExternal: true`.

## Thresholds

Positive numbers are minimum percentages. Negative numbers are the maximum count of uncovered items:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        functions: 90,
        lines: -10, // at most 10 uncovered lines

        // aggregate must meet the thresholds above; every file must also hit 50
        perFile: { lines: 50, functions: 50, branches: 50, statements: 50 },

        // glob thresholds don't inherit top-level values or perFile
        'src/core/**': { 100: true, perFile: true },
        'src/utils/**': { lines: 90, branches: 85 },
      },
    },
  },
})
```

- `perFile: true` checks each file against the top-level thresholds **instead of** the aggregate. An object (new in 5.0) checks **both**: the aggregate against the top-level thresholds, and each file against the object.
- `thresholds.100: true` is shorthand for 100 on all four metrics.
- Files matched by glob patterns still count toward the global thresholds. This differs from Jest.
- **Version note (5.0):** glob thresholds no longer inherit the top-level `perFile`. Add `perFile: true` to each glob that needs it.
- `autoUpdate: true` raises thresholds in the config file when coverage improves. Pass a function to round the value (it receives `(newThreshold, previousThreshold)` in 5.x):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        autoUpdate: (next) => Math.floor(next),
        lines: 82,
      },
    },
  },
})
```

## Coverage Reporters

`coverage.reporter` is separate from `test.reporters`. Default: `['text', 'html', 'clover', 'json']`.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      reporter: [
        ['text', { skipFull: true }],
        'text-summary',
        ['lcov', { projectRoot: './src' }],     // Codecov / SonarQube / Coveralls
        ['json', { file: 'coverage.json' }],
        ['html', { theme: 'legacy' }],          // 5.1: 'light' | 'dark' | 'legacy'
      ],
    },
  },
})
```

- The HTML coverage report appears in Vitest UI and the HTML test reporter when you use the `html`, `html-spa`, or `lcov` reporters. Custom reporters need `coverage.htmlDir`.
- When Vitest detects an AI coding agent, it adds `text-summary` and sets `skipFull` on `text` automatically.
- `coverage.skipFull: true` hides files with 100% coverage in all reporters.

## Ignoring Code

Use hint comments, adding `-- @preserve` so that esbuild doesn't strip them during TypeScript transpilation:

```ts
/* v8 ignore next -- @preserve */
function debugOnly() {
  console.log('not counted')
}

/* v8 ignore start -- @preserve */
if (process.env.LEGACY) {
  legacyPath()
}
/* v8 ignore stop -- @preserve */

/* v8 ignore if -- @preserve */
if (isServer) {
  serverOnly()
}
```

- `v8` supports `next`, `start`/`stop`, `if`, `else`, and `file`. With `istanbul`, use `/* istanbul ignore ... -- @preserve */`.
- `@preserve` comments may survive into production builds.
- `coverage.ignoreClassMethods: ['toJSON']` ignores methods by name.
- **5.1 (`v8` only):** `coverage.ignoreNode(node, type)` ignores generated code that can't carry a comment, such as React Compiler cache branches. Return `true` to ignore that node, or `'ignore-this-and-nested-nodes'` to also ignore its children.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      ignoreNode: (node, type) =>
        type === 'statement'
        && node.type === 'ExpressionStatement'
        && node.expression.type === 'CallExpression'
        && node.expression.callee.type === 'Identifier'
        && node.expression.callee.name === '__generatedHelper',
    },
  },
})
```

## Coverage in Browser Mode, Subprocesses, and Shards

- **Browser Mode:** `v8` collects coverage through the Chrome DevTools Protocol, so it only works in Chromium-based browsers. For Firefox or WebKit instances, use `istanbul`.
- **Child processes and worker threads** spawned by your code are not covered by default. With `v8`, `coverage.autoAttachSubprocess: true` (5.0) tracks them. It has overhead, because it writes many files through `NODE_V8_COVERAGE`.
- **Shards:** run each shard with `--coverage --reporter=blob`, then run `vitest --merge-reports --coverage` to produce one report. See [ci.md](ci.md#sharding-and-merging-reports).
- **Changed files only:** `coverage.changed` (inherits from `--changed`) limits coverage collection to changed files.
- **Slow coverage:** run `DEBUG=vitest:coverage vitest run --coverage` to log per-file processing times. `coverage.processingConcurrency` controls parallelism.

## Using Coverage Well

- Treat coverage as a map of **untested code**, not a quality score. A covered line can still have no assertion on it.
- Set thresholds near the current level and ratchet them up with `autoUpdate`. Don't jump to 100% globally. Reserve `100: true` for small, critical globs.
- Use `perFile` minimums to stop new files from landing untested while the aggregate looks fine.
- Prefer a test that asserts behavior over an ignore hint. Use ignore hints for platform branches, debug code, and generated code.

## Anti-Patterns to Avoid

| Anti-Pattern                                  | Problem                                                      | Solution                                                      |
| --------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| No `coverage.include`                         | Untested files missing from the report; inflated percentage  | `include: ['src/**/*.{ts,tsx}']`                              |
| 4.x-style loose include patterns after upgrading | 5.x matches root-relative paths; files drop out silently  | Re-check the reported file list                               |
| Top-level `perFile` expected to cover globs   | 5.x globs don't inherit it                                   | Set `perFile` on each glob                                    |
| `/* v8 ignore next */` without `@preserve` in TS | esbuild strips the comment; the hint does nothing         | `/* v8 ignore next -- @preserve */`                           |
| `--coverage --coverage.provider=istanbul`     | Dot options need `--coverage.enabled`                        | `--coverage.enabled --coverage.provider=istanbul`             |
| `reportsDirectory` set to a shared folder     | It is wiped before each run                                  | Use a dedicated directory                                     |
| `v8` with Firefox/WebKit browser instances    | No V8 coverage outside Chromium                              | `istanbul`                                                    |
| Chasing 100% with ignore hints                | Hides untested logic                                         | Test the behavior or accept a lower threshold                 |
| Assertion-free tests written to raise coverage | Lines execute, nothing is verified                          | Assert observable results                                     |

## Related References

- **Sharding and merging coverage**: [ci.md](ci.md)
- **Test reporters (separate from coverage reporters)**: [reporters.md](reporters.md)
- **Coverage overhead and caches**: [performance.md](performance.md)
- **Browser Mode**: [browser-mode.md](../testing-patterns/browser-mode.md)
- **Config basics**: [configuration.md](../core/configuration.md)
