# Type Testing

## Table of Contents

1. [What Type Tests Are For](#what-type-tests-are-for)
2. [Files and Running](#files-and-running)
3. [expectTypeOf](#expecttypeof)
4. [assertType](#asserttype)
5. [Negative Tests with @ts-expect-error](#negative-tests-with-ts-expect-error)
6. [Configuration](#configuration)
7. [Reading Type Errors](#reading-type-errors)
8. [Common Pitfalls](#common-pitfalls)

## What Type Tests Are For

Type tests check the compile-time contract of a library or utility type: inference of generics, overload resolution, narrowing by type guards, which calls are rejected. They matter most for published packages and shared helpers whose types are part of the API.

Vitest does **not run** type test files. It runs `tsc --noEmit` (or `vue-tsc`) and maps compiler errors back to the tests. `expectTypeOf` and `assertType` do nothing at runtime.

```ts
// src/pick.test-d.ts
import { assertType, describe, expectTypeOf, test } from 'vitest'
import { pick } from './pick'

describe('pick', () => {
  test('returns only the picked keys', () => {
    const result = pick({ a: 1, b: 'x', c: true }, ['a', 'b'])
    expectTypeOf(result).toEqualTypeOf<{ a: number; b: string }>()
  })

  test('rejects unknown keys', () => {
    // @ts-expect-error 'z' is not a key of the object
    assertType(pick({ a: 1 }, ['z']))
  })
})
```

## Files and Running

- Default `typecheck.include` is `['**/*.{test,spec}-d.?(c|m)[jt]s?(x)']`, so `*.test-d.ts` / `*.spec-d.ts`.
- Type checking is **off by default**. Enable it with `--typecheck` (runs type tests alongside runtime tests) or `--typecheck.only` (only type tests).

```bash
npx vitest --typecheck             # runtime + type tests
npx vitest run --typecheck.only    # only type tests, e.g. in a CI "types" job
```

```json
{
  "scripts": {
    "test": "vitest --typecheck",
    "test:types": "vitest run --typecheck.only"
  }
}
```

- Filters work as usual: `-t`, file name filters, `--allowOnly`.
- Because files are not executed, dynamic names in `test.each`/`test.for` are shown as written, not interpolated.
- Vitest also reports type errors in **source** files it sees, and fails the suite on them. Turn that off only deliberately with `typecheck.ignoreSourceErrors`.
- `vitest run` without `--typecheck` does not type-check anything. Keep `tsc --noEmit` (or `vitest --typecheck`) in CI.

## expectTypeOf

Fluent assertions on types. Prefer the type-argument form (`toEqualTypeOf<T>()`) over passing a value; it gives clearer error messages.

```ts
import { expectTypeOf, test } from 'vitest'
import { createStore, isUser, parse } from './lib'

test('core matchers', () => {
  expectTypeOf(parse('1')).toEqualTypeOf<number | null>()
  expectTypeOf({ a: 1, b: 1 }).not.toEqualTypeOf<{ a: number }>()

  // Subtype ("assignable to")
  expectTypeOf<number>().toExtend<string | number>()

  // Partial match on plain object types (stricter than toExtend, catches readonly)
  expectTypeOf(createStore()).toMatchObjectType<{ state: { count: number } }>()

  expectTypeOf('x').toBeString()
  expectTypeOf(undefined as string | undefined).toBeNullable()
})

test('functions', () => {
  expectTypeOf(parse).toBeFunction()
  expectTypeOf(parse).parameter(0).toBeString()
  expectTypeOf(parse).parameters.toEqualTypeOf<[input: string]>()
  expectTypeOf(parse).returns.toEqualTypeOf<number | null>()
  expectTypeOf(parse).toBeCallableWith('42')

  expectTypeOf(isUser).guards.toEqualTypeOf<User>() // `v is User`
  expectTypeOf(fetchUser).returns.resolves.toEqualTypeOf<User>()
})

test('classes and unions', () => {
  expectTypeOf(Date).toBeConstructibleWith('2000-01-01')
  expectTypeOf(Date).instance.toHaveProperty('toISOString')

  type Prop = string | string[] | { xs?: string }
  expectTypeOf<Prop>().extract<unknown[]>().toEqualTypeOf<string[]>()
  expectTypeOf<Prop>().exclude<unknown[] | { xs?: unknown }>().toEqualTypeOf<string>()
})
```

| Need | Matcher |
| --- | --- |
| Exact type | `toEqualTypeOf<T>()` |
| Assignable to | `toExtend<T>()` (replaces deprecated `toMatchTypeOf`) |
| Subset of a plain object type | `toMatchObjectType<T>()` (not for unions) |
| Property exists, then chain | `toHaveProperty('key').toBeNumber()` |
| Function args / return / async | `.parameter(n)`, `.parameters`, `.returns`, `.returns.resolves` |
| Guard / assertion function | `.guards`, `.asserts` |
| Union members | `.extract<T>()`, `.exclude<T>()` |
| Array items | `.items` |
| Structurally equal but differently written (intersections) | `.branded.toEqualTypeOf<T>()` (slow on deep types; use sparingly) |

`.returns`, `.parameters`, `.instance`, etc. resolve to `never` when used on the wrong kind of type, and later matchers fail with confusing messages. Check that the subject is what you think it is first.

## assertType

The simplest form: the argument must be assignable to the type argument.

```ts
import { assertType, test } from 'vitest'

test('overloads resolve', () => {
  assertType<string>(concat('a', 'b'))
  assertType<number>(concat(1, 2))
})
```

`assertType<T>(value)` checks assignability, not exact equality. A value of type `'a'` passes `assertType<string>`. Use `expectTypeOf(value).toEqualTypeOf<T>()` when the exact type matters (for example, that inference did not widen to `any`).

## Negative Tests with @ts-expect-error

To assert that something does **not** compile, put `// @ts-expect-error` on the line above. The test fails if that line compiles.

```ts
import { assertType, expectTypeOf, test } from 'vitest'

test('rejects wrong input', () => {
  // @ts-expect-error id must be a string
  assertType(getUser({ id: 42 }))

  // Prefer a matcher when one exists: it can't pass for the wrong reason
  expectTypeOf(getUser).parameter(0).not.toExtend<{ id: number }>()
})
```

`@ts-expect-error` passes for **any** error on that line, including a typo:

```ts
// @ts-expect-error answer is not a string
assertType<string>(answr) // passes: the error is "Cannot find name 'answr'", not the one you meant
```

Mitigations:

- Keep each `@ts-expect-error` line minimal: one call, already-typed variables declared on earlier lines.
- Write the reason after the directive so reviewers can check it.
- The docs suggest also including type test files in the runtime `include`, so a typo throws a `ReferenceError` when the file runs. Only do this if the file has no side effects that break at runtime.
- Use `@ts-expect-error`, never `@ts-ignore`: `@ts-ignore` doesn't fail when the error disappears.

## Configuration

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    typecheck: {
      enabled: true, // same as --typecheck
      include: ['**/*.{test,spec}-d.?(c|m)[jt]s?(x)'], // default
      tsconfig: './tsconfig.vitest.json', // default: closest tsconfig.json
      checker: 'tsc', // or 'vue-tsc' for .vue files (install vue-tsc)
      // ignoreSourceErrors: false, // default; true hides errors outside test files
    },
  },
})
```

- `typecheck.only: true` runs only type tests when type checking is enabled.
- `typecheck.allowJs` checks JS files that have `// @ts-check`.
- `typecheck.spawnTimeout` (default `10_000` ms) is the minimum time Vitest allows for spawning the checker.
- If `include` and `typecheck.include` overlap, Vitest reports the runtime run and the type run as separate entries.

## Reading Type Errors

Assertions are written as `expect<Actual>().toEqualTypeOf<Expected>()`, so the error is reported on the **expected** type argument. Look for the property name and the `Expected: ..., Actual: ...` text:

```
error TS2344: Type '{ a: string; }' does not satisfy the constraint '{ a: "Expected: string, Actual: number"; }'.
```

For `toBeString()`-style matchers, the failure reads `This expression is not callable. Type 'ExpectString<number>' has no call signatures`: you passed a `number` where a `string` was expected.

When matcher errors are hard to read, compare two concrete values with `toEqualTypeOf<typeof other>()`, or fall back to `assertType<T>(value)`.

## Common Pitfalls

- **`expectTypeOf` in a `.test.ts` file without `--typecheck` (or `tsc`)** checks nothing. The runtime call is a no-op. Put type tests in `*.test-d.ts` and enable typecheck in CI.
- **`any` leaks.** `any` is assignable to everything, so `assertType<T>(anyValue)` passes silently. Add `expectTypeOf(x).not.toBeAny()` for values that must be inferred.
- **Runtime code in type tests never runs.** Don't put runtime `expect(...)` assertions in `*.test-d.ts`; they are type-checked, not executed.
- **`toMatchTypeOf` is deprecated** (since expect-type 1.2). Use `toExtend`, or `toMatchObjectType` for plain objects.
- **`toMatchObjectType` fails on unions.** Use `toExtend` there.
- **Testing library internals.** Type-test the public signatures users call, not internal helper types.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `expectTypeOf` in runtime tests with no typecheck step | Never evaluated; always "passes" | `*.test-d.ts` + `vitest --typecheck` or `tsc --noEmit` in CI |
| `@ts-ignore` for negative tests | Doesn't fail when the expected error goes away | `@ts-expect-error` with a reason |
| Long expressions on a `@ts-expect-error` line | An unrelated error (typo, wrong import) satisfies it | One minimal call per directive; prefer `.not.toExtend` / `toBeCallableWith` |
| `assertType<T>(x)` to prove exact inference | Only checks assignability; `any` passes | `expectTypeOf(x).toEqualTypeOf<T>()` |
| `toEqualTypeOf(value)` with a concrete value | Weaker error messages | `toEqualTypeOf<T>()` type argument |
| `toMatchTypeOf` | Deprecated | `toExtend` / `toMatchObjectType` |
| `.branded` everywhere | Slow and can make `tsc` give up on deep types | Only for intersections that are equal in practice |
| `typecheck.ignoreSourceErrors: true` to silence failures | Hides real type errors in source | Fix the source errors |

## Related References

- **Test layout and naming**: [test-structure.md](../core/test-structure.md)
- **Runtime assertions, `expect.assert` narrowing**: [assertions.md](../core/assertions.md)
- **Configuration and projects**: [configuration.md](../core/configuration.md), [projects.md](../core/projects.md)
- **CI jobs**: [ci.md](../infrastructure-ci-cd/ci.md)
