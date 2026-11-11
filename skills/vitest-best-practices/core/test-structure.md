# Test Structure

## Table of Contents

1. [Files and Layout](#files-and-layout)
2. [test, it, describe](#test-it-describe)
3. [Naming and Arrange-Act-Assert](#naming-and-arrange-act-assert)
4. [Parameterized Tests: test.for vs test.each](#parameterized-tests-testfor-vs-testeach)
5. [Test Options Object](#test-options-object)
6. [Concurrent Tests](#concurrent-tests)
7. [Shuffling](#shuffling)
8. [In-Source Testing](#in-source-testing)

## Files and Layout

The default `include` is `['**/*.{test,spec}.?(c|m)[jt]s?(x)']`, so `utils.test.ts`, `app.spec.tsx`, and `api.test.mjs` are found anywhere under the root. `node_modules` and `.git` are excluded.

```
src/
  formatPrice.ts
  formatPrice.test.ts        # co-located (one test file per source file)
  __tests__/
    cart.test.ts             # or a dedicated folder; both match the default glob
```

- Pick one layout and use it everywhere in the project.
- Split a test file that grows beyond a few hundred lines by feature (`userService.auth.test.ts`, `userService.creation.test.ts`). Smaller files are also easier to run on their own.
- Use a filename suffix (`*.integration.test.ts`, `*.browser.test.ts`) when different groups of files need different runner settings. Then route them with [projects](projects.md).

## test, it, describe

`test` and `it` are aliases. `describe` (alias `suite`) groups tests. Tests at the top level of a file belong to an implicit file suite.

```ts
import { describe, expect, test } from 'vitest'
import { formatPrice, parseAmount } from './money'

describe('formatPrice', () => {
  test('formats USD with two decimals', () => {
    expect(formatPrice(1234.5, 'USD')).toBe('$1,234.50')
  })

  test('returns "$0.00" for zero', () => {
    expect(formatPrice(0, 'USD')).toBe('$0.00')
  })
})

describe('parseAmount', () => {
  test('throws for non-numeric input', () => {
    expect(() => parseAmount('abc')).toThrow('Invalid amount')
  })
})
```

- If a test has no body, Vitest marks it as `todo`.
- If the test returns a promise, Vitest waits for it. A rejected promise fails the test. See [async-testing.md](async-testing.md).
- There is no `done` callback. Use an `async` function or wrap the callback in a `Promise`.
- Keep `describe` nesting to one or two levels. Deep nesting usually means the module under test does too much.
- The code inside a `describe` callback runs during **collection**, before any hook or test runs. Put setup in hooks or fixtures, not in the bare `describe` body ([fixtures-hooks.md](fixtures-hooks.md)).

## Naming and Arrange-Act-Assert

A name should state one behavior and the expected result. When the test fails in CI, the name is often the first thing someone reads.

| Weak                                    | Better                                          |
| --------------------------------------- | ----------------------------------------------- |
| `works correctly`                       | `returns 0 for an empty cart`                   |
| `calls Intl.NumberFormat`               | `formats EUR with a comma decimal separator`    |
| `validates and saves and sends email`   | Split into three tests                          |

If a name needs "and", split the test. The full name is `describe` names plus the test name, joined with `' > '` (for example `cart > total > returns 0 for an empty cart`). `-t` filtering matches against this string ([annotations-filtering.md](annotations-filtering.md)).

Structure each test as arrange, act, assert. You don't need comments to label the sections.

```ts
import { expect, test } from 'vitest'
import { ShoppingList } from './shopping-list'

test('remove() drops only the named item', () => {
  const list = new ShoppingList()
  list.add('milk')
  list.add('bread')

  list.remove('milk')

  expect(list.items()).toEqual(['bread'])
})
```

## Parameterized Tests: test.for vs test.each

Both run one test per case. **Prefer `test.for` in new code.** It passes the [test context](fixtures-hooks.md#test-context) as the second argument, so concurrent tests can use the local `expect` and snapshots. `test.each` exists for Jest compatibility.

The difference is that `test.each` **spreads** array cases into arguments, and `test.for` **does not**:

```ts
import { expect, test } from 'vitest'

test.each([
  [1, 1, 2],
  [1, 2, 3],
])('add(%i, %i) -> %i', (a, b, expected) => {
  expect(a + b).toBe(expected)
})

test.for([
  [1, 1, 2],
  [1, 2, 3],
])('add(%i, %i) -> %i', ([a, b, expected], { expect }) => {
  expect(a + b).toBe(expected)
})
```

Object cases read best because the title can refer to fields with `$name`:

```ts
import { expect, test } from 'vitest'
import { parseAge } from './parse-age'

test.for([
  { input: '25', expected: 25 },
  { input: '25.9', expected: 25 },
  { input: '0', expected: 0 },
  { input: '150', expected: 150 },
])('parseAge("$input") -> $expected', ({ input, expected }) => {
  expect(parseAge(input)).toBe(expected)
})

test.for(['-1', '151', 'abc', ''])('parseAge(%j) throws', (input) => {
  expect(() => parseAge(input)).toThrow('Invalid age')
})
```

Title placeholders:

- printf style: `%s`, `%d`, `%i`, `%f`, `%j`, `%o`, `%#` (0-based index), `%$` (1-based index), `%%`.
- `$field`, `$field.nested`, and `$0`/`$1` for array items.

> **Version note:** 5.x formats titles with `pretty-format`. A string inserted through a `$` placeholder is **no longer quoted** (`case a1`, not `case 'a1'`). Long values are truncated at `taskTitleValueFormatTruncate` (default `40`).

Use `describe.for` (or `describe.each`) when several tests share each data row:

```ts
import { describe, expect, test } from 'vitest'
import { convert } from './currency'

describe.for([
  { from: 'USD', to: 'EUR' },
  { from: 'EUR', to: 'GBP' },
])('convert $from -> $to', ({ from, to }) => {
  test('round-trips within a cent', () => {
    expect(convert(convert(100, from, to), to, from)).toBeCloseTo(100, 2)
  })

  test('rejects negative amounts', () => {
    expect(() => convert(-1, from, to)).toThrow()
  })
})
```

Tagged template tables (`` test.each`a | b | expected ...` ``) also work with both APIs.

## Test Options Object

The second argument can be an options object. Options on a `describe` apply to every test inside it, including nested suites.

```ts
import { describe, test } from 'vitest'

test('imports a large CSV', { timeout: 20_000 }, async () => { /* ... */ })

test('talks to a staging API', { retry: { count: 2, delay: 500, condition: /ECONNRESET/ } }, async () => { /* ... */ })

test('is stable', { repeats: 50 }, () => { /* ... */ })

describe('slow integration suite', { timeout: 30_000 }, () => {
  test('inherits the 30s timeout', async () => { /* ... */ })
})
```

| Option       | Meaning                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `timeout`    | ms before the test fails. Default `testTimeout` (5000 in Node)                                   |
| `retry`      | Number, or `{ count, delay, condition }`. `condition` can be a RegExp or a function (function only in test files) |
| `repeats`    | Extra runs regardless of result. Fails if any run fails. Use it to hunt flaky tests              |
| `concurrent` | Run concurrently with other concurrent tests in the suite. `false` opts out of inherited concurrency |
| `skip`, `only`, `todo`, `fails` | Same as the chained modifiers ([annotations-filtering.md](annotations-filtering.md)) |
| `tags`, `meta` | Tags for filtering and shared options; metadata for reporters                                  |
| `shuffle`    | (`describe` only) randomize test order in this suite                                             |

Options set to `undefined` are ignored and do not override inherited values.

A number as the **last** argument is a timeout, but you cannot combine it with an options object. Put `timeout` inside the object:

```ts
import { test } from 'vitest'

test('heavy', { retry: 2, timeout: 10_000 }, async () => { /* ... */ }) // ✅
test('heavy', async () => { /* ... */ }, 10_000)                         // ✅
// test('heavy', { retry: 2 }, async () => {}, 10_000)                   // ❌
```

## Concurrent Tests

Tests inside a file run **sequentially** by default. `test.concurrent` or `describe.concurrent` runs async tests in the same file in parallel. `maxConcurrency` caps how many run at once (default `5`). Synchronous tests still run one after another.

```ts
import { describe, test } from 'vitest'
import { fetchProfile, fetchSettings } from './api'

describe.concurrent('read-only API calls', () => {
  test('profile', async ({ expect }) => {
    expect(await fetchProfile('u1')).toMatchObject({ id: 'u1' })
  })

  test('settings', async ({ expect }) => {
    expect(await fetchSettings('u1')).toMatchSnapshot()
  })

  describe('writes', { concurrent: false }, () => {
    test('update 1', async () => { /* runs sequentially */ })
    test('update 2', async () => { /* runs sequentially */ })
  })
})
```

Rules for concurrent tests:

- Use `expect` from the **test context** (`async ({ expect }) => ...`) for snapshots and `expect.assertions`. The global `expect` cannot tell which concurrent test is running.
- Use `onTestFinished` and `onTestFailed` from the context, not the global imports.
- Do not share mutable state between concurrent tests. `clearMocks` (on by default), `mockReset`, `restoreMocks`, `unstubEnvs`, and `unstubGlobals` reset state for **every** test whenever another test starts, so mocks shared by concurrent tests are unsafe.

> **Version note:** `test.sequential`, `describe.sequential`, and the `sequential` option were **removed in 5.0**. Use `{ concurrent: false }`.

## Shuffling

`describe.shuffle` (or `{ shuffle: true }`) randomizes the order of tests in that suite. Nested suites inherit it, and `{ shuffle: false }` turns it off again. The order depends on `sequence.seed`, which defaults to `Date.now()`. Set the seed to reproduce an order.

```ts
import { describe, test } from 'vitest'

describe.shuffle('cart operations', () => {
  test('add', () => { /* ... */ })
  test('remove', () => { /* ... */ })
  test('clear', () => { /* ... */ })
})
```

```bash
npx vitest run --sequence.shuffle --sequence.seed=1234
```

## In-Source Testing

For small pure helpers, tests can live inside the source file behind `import.meta.vitest`. They share the module closure, so they can test private functions.

```ts
// src/slug.ts
function normalize(s: string) {
  return s.trim().toLowerCase()
}

export function slugify(s: string) {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('slugify collapses punctuation', () => {
    expect(slugify('  Hello, World! ')).toBe('hello-world')
  })
}
```

```ts
// vite.config.ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    includeSource: ['src/**/*.{js,ts}'],
  },
  define: {
    'import.meta.vitest': 'undefined', // dead-code-eliminate tests in production builds
  },
})
```

- Add `"vitest/importMeta"` to `compilerOptions.types` in `tsconfig.json`.
- Vitest finds in-source tests with a text check. Any matched file that contains the string `import.meta.vitest`, even in a comment, is treated as a test file.
- Use separate test files for components, integration tests, and anything bigger than a small helper.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `test.each([[a, b]])` with `({ expect })` in the callback | `each` spreads arrays and gives you no test context | Use `test.for` and destructure `([a, b], { expect })` |
| `test.sequential` / `describe.sequential` | Removed in 5.0. Throws a TypeError | `{ concurrent: false }` |
| Global `expect(...).toMatchSnapshot()` inside `test.concurrent` | Snapshot is attributed to the wrong test | Use the context `expect` |
| Setup code directly in a `describe` body | Runs during collection, before hooks, even for filtered-out tests | `beforeEach`/`beforeAll` or a fixture |
| `test(name, { tags }, fn, 10_000)` | A trailing timeout cannot be combined with options | `{ tags, timeout: 10_000 }` |
| One test asserting several unrelated behaviors | The first failure hides the rest, and the name can't describe it | One behavior per test; use `test.for` for input variations |
| Names like "works" or "handles edge case" | Failure output says nothing | Name the input and the expected outcome |
| Copy-pasted tests that differ only in data | Hard to maintain and easy to drift | `test.for` with object cases and `$field` titles |

## Related References

- **Assertions**: [assertions.md](assertions.md)
- **Async tests and timeouts**: [async-testing.md](async-testing.md)
- **Hooks, context, fixtures**: [fixtures-hooks.md](fixtures-hooks.md)
- **skip/only/todo, tags, filtering**: [annotations-filtering.md](annotations-filtering.md)
- **Flaky tests, order dependence**: [flaky-tests.md](../debugging/flaky-tests.md)
- **Type-level tests**: [type-testing.md](../testing-patterns/type-testing.md)
