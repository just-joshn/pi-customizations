# Annotations & Filtering

## Table of Contents

1. [Modifiers: skip, only, todo, fails](#modifiers-skip-only-todo-fails)
2. [Conditional Skipping](#conditional-skipping)
3. [Guarding Against Committed .only](#guarding-against-committed-only)
4. [CLI Filtering](#cli-filtering)
5. [Running Only Affected or Failed Tests](#running-only-affected-or-failed-tests)
6. [Test Tags](#test-tags)
7. [Test Annotations](#test-annotations)
8. [Metadata](#metadata)

## Modifiers: skip, only, todo, fails

Each modifier works on `test`/`it` and `describe`, and has an equivalent option (`{ skip: true }`, ...).

```ts
import { describe, expect, test } from 'vitest'
import { add, legacyRound } from './math'

test.skip('flaky upstream API (see #482)', async () => { /* ... */ })

test.only('debugging this one', () => {           // other tests in the FILE are skipped
  expect(add(1, 2)).toBe(3)
})

test.todo('handles currency rounding')            // placeholder, shown in the report
describe.todo('refund flow')

test.fails('known bug #1234: rounds half down', () => {
  expect(legacyRound(2.5)).toBe(3)                // passes while this assertion FAILS
})

test.concurrent.skip('chains with other modifiers', async () => {})
```

- `.only` affects only the file it is in. To focus one test, also pass the file path on the CLI.
- `test.fails` documents a known bug. When the bug is fixed the test starts failing, which tells you to remove `.fails`.
- `todo` and `skip` show up in the summary. Leave a reason in the name or a comment.

## Conditional Skipping

```ts
import { describe, test } from 'vitest'

const isWindows = process.platform === 'win32'

test.skipIf(isWindows)('uses POSIX permissions', () => { /* ... */ })
test.runIf(process.env.DATABASE_URL)('talks to a real database', async () => { /* ... */ })
describe.skipIf(!process.env.CI)('CI-only smoke checks', () => { /* ... */ })

test('needs a GPU', ({ skip }) => {
  skip(!hasGpu(), 'no GPU on this runner')
  // ...
})

function hasGpu() { return false }
```

- `skipIf` and `runIf` **always** set `skip`. A falsy `skipIf` condition overrides a `skip` inherited from a tag.
- `context.skip()` with no condition skips immediately. Use it when the decision depends on something only known at runtime (a probe, a missing binary).
- Do not wrap tests in `if (...) { test(...) }`. A test hidden that way disappears from the report.

## Guarding Against Committed .only

`allowOnly` defaults to `!process.env.CI`. In CI, any `.only` **fails the run**. Locally, `.only` is allowed.

```bash
npx vitest run --allowOnly=false   # enforce locally too (e.g. in a pre-push hook)
```

The `no-focused-tests` rule from the Vitest ESLint plugin (`vitest-dev/eslint-plugin-vitest`, also in oxlint) catches `.only` in the editor.

## CLI Filtering

```bash
npx vitest run cart                               # files whose path contains "cart"
npx vitest run src/cart/cart.test.ts:42           # the test containing line 42 (full path + extension)
npx vitest run src/a.test.ts:10 src/a.test.ts:25  # several lines (no ranges)
npx vitest run src/cart.test.ts -t 'empty cart'   # name filter (regex)
npx vitest run -t 'cart > total > returns 0'      # full name with " > "
npx vitest run --exclude 'src/legacy/**'          # adds to config exclude
npx vitest run --project unit                     # see projects.md
```

> **Version note:** In 5.x `-t` / `testNamePattern` matches the **full name joined with `' > '`** (`math > adds`), the same string the reporter prints. In 4.x and Jest the parts were joined with a space, so `-t 'math adds'` no longer matches across a suite boundary. Match one segment (`-t adds`) or use `-t 'math.*adds'`.

`-t`, `.only`, `.skip`, and tag filters are applied **per file**. Vitest still loads every matched file to find the tests in it. Always pass a file path too, so it doesn't load unrelated files. `--experimental.preParse` can find test names by parsing files instead of running them.

## Running Only Affected or Failed Tests

| Command | Selects | Notes |
| --- | --- | --- |
| `vitest run --changed` | Tests affected by uncommitted (staged + unstaged) changes | Needs Git. `--changed origin/main` for a branch, `--changed HEAD~1` for the last commit |
| `vitest run --since-last-run` | Tests whose loaded files changed (by mtime) since they last ran, plus files that failed last time | **Experimental, 5.1.** No Git needed. Needs `cache`. The first run is a full run |
| `vitest run --last-failed` | Only the tests that failed in the previous run | **5.1.** Uses the results cache. Can be combined with `-t` |
| `vitest related src/a.ts --run` | Tests that statically import the given source files | Good for `lint-staged`. Imports with non-literal paths (`import(filepath)`) are not followed |

Agent workflow: after each edit run `vitest run --since-last-run`, and before finishing run a full `vitest run`. `--since-last-run` cannot see new files that no test loaded before (a new `.env`, a new `__mocks__` file) or mtimes reset by a checkout. The final full run covers those. `--clearCache` resets the records.

## Test Tags

Tags label tests across files. They let you filter by category and **apply shared options** such as timeout, retry, or skip. Define them in config. With `strictTags` (default `true`), an unknown tag is an error, which catches typos.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    tags: [
      { name: 'unit', description: 'Fast, no I/O.' },
      { name: 'db', description: 'Needs a database.', timeout: 60_000 },
      { name: 'flaky', description: 'Known flaky; retried on CI.', retry: process.env.CI ? 3 : 0, priority: 1 },
      { name: 'skip-ci', skip: !!process.env.CI },
    ],
  },
})
```

```ts
// vitest.shims.d.ts: typed tag names (include in tsconfig)
import 'vitest'

declare module 'vitest' {
  interface TestTags {
    tags: 'unit' | 'db' | 'flaky' | 'skip-ci'
  }
}
```

```ts
/**
 * @module-tag db
 */
import { describe, test } from 'vitest'

describe('user repository', { tags: ['unit'] }, () => {   // inherited by children
  test('finds by email', () => { /* tags: db, unit */ })
  test('retries on deadlock', { tags: ['flaky'] }, () => { /* db, unit, flaky */ })
})
```

- `@module-tag` in a JSDoc comment tags **every** test in the file, wherever the comment appears. Tag single tests with the `tags` option.
- When several tags set the same option, the lowest `priority` number wins. Tags without a `priority` are applied first and lose to tags that have one. The test's own options beat every tag.
- Tag names cannot be `and`/`or`/`not` and cannot contain `( ) & | ! *` or spaces.
- Inline projects inherit the root `tags`. A project's own `tags` replace them.

Filter with `--tags-filter`. It supports `and`/`&&`, `or`/`||`, `not`/`!`, `*` wildcards, and parentheses. Several `--tags-filter` flags are combined with AND.

```bash
npx vitest run --tags-filter='db && !flaky'
npx vitest run --tags-filter='(unit || db) && !slow'
npx vitest --list-tags          # print defined tags (or --list-tags=json)
```

Skip expensive setup when the filter excludes the tests that need it:

```ts
import { beforeAll, TestRunner } from 'vitest'
import { seedDatabase } from './db'

beforeAll(async () => {
  if (TestRunner.matchesTags(['db'])) await seedDatabase()
})
```

**Tags or projects?** Tags change per-test options (timeout, retry, skip) and support cross-cutting filters. [Projects](projects.md) change runner settings (environment, pool, isolation) per group of files.

## Test Annotations

`annotate` attaches a message, and optionally a type and an attachment, to the test. The message shows up in reporters: the default reporter (only on failure), `verbose`, `html`/UI, `junit` (as properties), `github-actions` (as notice/warning/error), and `tap`.

```ts
import { test } from 'vitest'
import { renderReport } from './report'

test('renders the monthly report', async ({ annotate }) => {
  await annotate('https://github.com/acme/app/issues/953', 'issue')
  const html = await renderReport('2026-10')
  await annotate('rendered output', { contentType: 'text/html', body: html, bodyEncoding: 'utf-8' })
})
```

`annotate` returns a promise. Vitest awaits pending annotations before the test ends. Await it yourself if later code depends on it.

## Metadata

`meta` attaches custom data to a test or suite. Reporters read it with `TestCase.meta()`. A test can also add to `task.meta` while it runs. Suites and tags merge their meta into the test's **one level deep**, so a nested object is replaced, not merged. Keep meta flat. Declare your keys on `TaskMeta` so they type-check:

```ts
import { test } from 'vitest'

declare module 'vitest' {
  interface TaskMeta {
    owner?: string
    jira?: string
  }
}

test('checkout total', { meta: { owner: 'payments', jira: 'PAY-12' } }, () => { /* ... */ })
```

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Committing `.only` | Silently skips the rest of the file; fails the run in CI | Remove it. Use `allowOnly=false` and `no-focused-tests` |
| `if (cond) test(...)` | Test vanishes from the report | `test.skipIf(cond)` / `context.skip(cond, note)` |
| `-t 'suite test'` with a space separator | Doesn't match in 5.x | `-t 'suite > test'` or one segment |
| `-t` without a file path in a large repo | Loads every test file | `vitest run path/to/file.test.ts -t name` |
| Long-lived `test.skip` with no reason | Dead tests pile up | Put a reason/issue in the name, or `test.fails` for known bugs |
| `@module-tag` above a single test | Tags every test in the file | `{ tags: [...] }` on that test |
| Mistyped tag with `strictTags: false` | Test silently filtered out or misconfigured | Keep `strictTags` on and type `TestTags` |
| Using `--since-last-run` as the only check | Misses files no test loaded before, and reset mtimes | Finish with a full `vitest run` |
| Separate projects only to set a longer timeout | Unnecessary config split | Tags with `timeout` |

## Related References

- **Test options object (timeout, retry, repeats)**: [test-structure.md](test-structure.md#test-options-object)
- **Projects and `--project`**: [projects.md](projects.md)
- **Config: allowOnly, retry, tags**: [configuration.md](configuration.md)
- **CI sharding and reruns**: [ci.md](../infrastructure-ci-cd/ci.md)
- **Reporters that show annotations**: [reporters.md](../infrastructure-ci-cd/reporters.md)
- **Debugging a single failing test**: [debugging.md](../debugging/debugging.md)
