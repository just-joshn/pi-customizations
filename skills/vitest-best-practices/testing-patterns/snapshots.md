# Snapshots

## Table of Contents

1. [When to Use a Snapshot](#when-to-use-a-snapshot)
2. [toMatchSnapshot](#tomatchsnapshot)
3. [toMatchInlineSnapshot](#tomatchinlinesnapshot)
4. [toMatchFileSnapshot](#tomatchfilesnapshot)
5. [Dynamic Values: Property Matchers](#dynamic-values-property-matchers)
6. [Updating and Reviewing Snapshots](#updating-and-reviewing-snapshots)
7. [Obsolete Snapshots and CI](#obsolete-snapshots-and-ci)
8. [Serializers and snapshotFormat](#serializers-and-snapshotformat)
9. [Concurrent Tests](#concurrent-tests)
10. [Version Notes](#version-notes)

## When to Use a Snapshot

Use a snapshot when you want to catch **any** change to structured, serializable output: generated code, CLI output, formatted error messages, a large config object, rendered markup. Use a targeted assertion when only a few fields matter.

```ts
import { expect, test } from 'vitest'

// ❌ Snapshot of a whole user when the test is about the role
test('promotes the user', () => {
  expect(promote(user)).toMatchSnapshot()
})

// ✅ The assertion states the behavior
test('promotes the user to admin', () => {
  expect(promote(user)).toMatchObject({ role: 'admin' })
})
```

Rules of thumb:

- If a reviewer can't tell from the snapshot what behavior is protected, use explicit assertions.
- Output with timestamps, random IDs, or absolute paths needs [property matchers](#dynamic-values-property-matchers) or a [serializer](#serializers-and-snapshotformat), or it will churn.
- Snapshots are assertions. Commit them and review their diffs in code review.

## toMatchSnapshot

Stores the serialized value in `__snapshots__/<test-file>.snap` next to the test file. The first run writes it; later runs compare.

```ts
import { expect, test } from 'vitest'
import { buildConfig } from './config'

test('builds the production config', () => {
  expect(buildConfig({ env: 'production' })).toMatchSnapshot()
})

test('builds configs per region', () => {
  // A hint names the entry instead of relying on the counter (" 1", " 2")
  expect(buildConfig({ region: 'eu' })).toMatchSnapshot('eu')
  expect(buildConfig({ region: 'us' })).toMatchSnapshot('us')
})
```

Entries are keyed by the test's full name plus the hint or a counter, and Vitest uses `>` as the separator (`builds configs per region > eu 1`). Renaming a test makes its old entry obsolete.

## toMatchInlineSnapshot

Vitest writes the snapshot into the test file as the matcher's argument. Start with no argument and run the test once.

```ts
import { expect, test } from 'vitest'

test('formats a greeting', () => {
  expect(greet('Alice')).toMatchInlineSnapshot(`
    {
      "message": "Hello, Alice!",
      "version": 2,
    }
  `)
})
```

Prefer inline snapshots for small values: the expected output sits next to the code that produces it. Use `.snap` files or file snapshots for large output.

## toMatchFileSnapshot

Compares against a file you name, with any extension, so the output keeps syntax highlighting and can be opened with normal tools. It is **async**: always `await` it.

```ts
import { expect, test } from 'vitest'

test('renders the invoice template', async () => {
  const html = renderInvoice(sampleInvoice)
  await expect(html).toMatchFileSnapshot('./__fixtures__/invoice.output.html')
})
```

- **Version note (5.0):** an unawaited `toMatchFileSnapshot` fails the test. In 4.x it was auto-awaited with a warning.
- Don't point it at a path Vitest manages (such as `__snapshots__/x.test.ts.snap`). Use a separate naming pattern.

## Dynamic Values: Property Matchers

Pass an object of asymmetric matchers as the first argument. Those fields are checked against the matchers; the rest is snapshotted.

```ts
import { expect, test } from 'vitest'

test('creates a user record', () => {
  const user = createUser('Alice')

  expect(user).toMatchSnapshot({
    id: expect.any(String),
    createdAt: expect.any(Date),
  })
})

test('inline with property matchers', () => {
  expect(createUser('Bob')).toMatchInlineSnapshot(
    { id: expect.any(String), createdAt: expect.any(Date) },
    `
    {
      "createdAt": Any<Date>,
      "id": Any<String>,
      "name": "Bob",
    }
  `,
  )
})
```

Other options for volatile output:

- Freeze time with `vi.setSystemTime()` / fake timers before producing the value ([timers-dates.md](../mocking/timers-dates.md)).
- Normalize strings before snapshotting (replace absolute paths, trim durations).
- Add a serializer for a recurring type ([below](#serializers-and-snapshotformat)).

## Updating and Reviewing Snapshots

| How | What it does |
| --- | --- |
| `vitest -u` / `vitest --update` | Updates changed snapshots and deletes obsolete ones (same as `--update=all`) |
| `--update=new` | Writes only missing snapshots; leaves changed and obsolete ones alone |
| `--update=none` | Writes nothing; fails on mismatched, missing, and obsolete snapshots |
| `u` in watch mode | Updates all failed snapshots at once |
| `i` in watch mode (5.1) | Interactive review: shows each failed snapshot; `a` accepts, `r` keeps the old one |

```bash
# Update only the file you changed, then read the diff
npx vitest run src/report.test.ts -u
git diff -- '**/__snapshots__/**' src/report.test.ts
```

Only update after confirming the new output is correct. A failing snapshot means either the code has a bug or the expected output changed; `-u` can't tell the difference. The 5.1 interactive review (`i`) covers inline snapshots, `.snap` files, file snapshots, and ARIA snapshots, and lets you accept changes one by one instead of all at once.

## Obsolete Snapshots and CI

An obsolete snapshot is an entry or file that no longer matches any collected test, usually after a rename or deletion.

The `update` option defaults to `false`, which resolves by environment:

- **Local** (no `CI` env var): behaves like `'new'` — missing snapshots are written, mismatches fail.
- **CI** (`process.env.CI` truthy): behaves like `'none'` — nothing is written, and mismatched, **missing**, or **obsolete** snapshots fail the run.

So a test whose snapshot was never committed fails in CI. Run the suite locally, review, and commit the snapshot files. Clean obsolete entries with `vitest run -u`, review the deletions, and commit them.

## Serializers and snapshotFormat

`snapshotFormat` sets formatting options on top of `@vitest/pretty-format`. Vitest's defaults are `printBasicPrototype: false` (prints `{}`/`[]`, not `Object {}`/`Array []`), `escapeString: false`, `escapeRegex: true`, and `printFunctionName: false`. `plugins` in `snapshotFormat` is ignored; use serializers instead.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    snapshotFormat: {
      printBasicPrototype: true, // Jest < 29 style, only if migrating old snapshots
    },
    snapshotSerializers: ['./test/serializers/money.ts'],
  },
})
```

A serializer has `test` (does it handle this value?) and `serialize`. Register it per file with `expect.addSnapshotSerializer`, or for every file with `snapshotSerializers`.

```ts
// test/serializers/money.ts
import type { SnapshotSerializer } from 'vitest'

export default {
  test: (val) => val instanceof Money,
  serialize: (val, config, indentation, depth, refs, printer) =>
    `Money<${printer(val.toString(), config, indentation, depth, refs)}>`,
} satisfies SnapshotSerializer
```

```ts
import { expect } from 'vitest'
import moneySerializer from './serializers/money'

expect.addSnapshotSerializer(moneySerializer)
```

To store `.snap` files somewhere else (for example next to the test file), use `resolveSnapshotPath(testPath, snapExtension) => string` in config.

## Concurrent Tests

With `test.concurrent`, the global `expect` can't tell which test a snapshot belongs to. Use `expect` from the test context.

```ts
import { test } from 'vitest'

test.concurrent('renders header', async ({ expect }) => {
  expect(await render('header')).toMatchSnapshot()
})
```

## Version Notes

- **5.0 — inspected values use `pretty-format` instead of `loupe`.** This includes values interpolated into `test.each`/`test.for` titles. String values through a `$` placeholder are no longer quoted (`case 'a1'` → `case a1`). Snapshot entries keyed by those titles show up as obsolete plus new after upgrading; review and update them in one commit. Snapshots or assertions that capture inspected output may also need updating.
- **5.0 — unawaited `toMatchFileSnapshot` fails the test.**
- **5.1 — interactive snapshot review** with `i` in watch mode.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Snapshotting everything by default | Tests pass for any output that matches the last run; intent is invisible | Targeted assertions; snapshots for large structured output |
| Running `-u` to make the build green | Accepts regressions as the new baseline | Read each diff; use `i` interactive review in 5.1 |
| Snapshotting values with timestamps or random IDs | Fails on every run | Property matchers, fake timers, or a serializer |
| `expect(x).toMatchFileSnapshot(path)` without `await` | Fails the test in 5.x | `await expect(x).toMatchFileSnapshot(path)` |
| Not committing `.snap` files | CI (`update: 'none'`) fails on missing snapshots | Commit snapshots with the test |
| Global `expect` snapshots in `test.concurrent` | Snapshot is attributed to the wrong test | Context `expect` |
| Huge snapshots of whole DOM trees | Nobody reviews them; noisy diffs | Assert user-visible behavior; ARIA snapshots in browser mode |
| Leaving obsolete entries after renames | CI fails on obsolete snapshots | `vitest run -u`, review, commit |

## Related References

- **Matchers and asymmetric matchers**: [assertions.md](../core/assertions.md)
- **Error snapshots**: [error-testing.md](error-testing.md)
- **Freezing time for stable output**: [timers-dates.md](../mocking/timers-dates.md)
- **ARIA snapshots and screenshots**: [browser-mode.md](browser-mode.md)
- **Concurrent tests and test context**: [test-structure.md](../core/test-structure.md)
- **Upgrading from 4.x or Jest**: [migration.md](../architecture/migration.md)
