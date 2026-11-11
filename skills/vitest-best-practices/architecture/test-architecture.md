# Test Architecture

## Table of Contents

1. [Choosing the Test Type](#choosing-the-test-type)
2. [Decision Tree](#decision-tree)
3. [Balancing the Suite](#balancing-the-suite)
4. [File Layout and Naming](#file-layout-and-naming)
5. [One Project per Test Type](#one-project-per-test-type)
6. [In-Source Tests](#in-source-tests)
7. [Type Tests](#type-tests)

## Choosing the Test Type

| Type                      | Runs in                         | Good for                                                        | Cost / limits                                                  |
| ------------------------- | ------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| **Node unit**             | `environment: 'node'`           | Pure logic, parsers, reducers, services with faked I/O          | Fastest. No DOM                                                |
| **Node integration**      | `node` + real DB/HTTP/fs        | Module boundaries, queries, request handlers                    | Needs per-worker data isolation; slower                        |
| **DOM-env component**     | `jsdom` / `happy-dom` in Node   | Rendering logic, events, accessibility queries, fast feedback   | Simulated DOM: no layout, real CSS, or focus/scroll fidelity    |
| **Browser Mode**          | Real browser via Playwright/WebdriverIO | Components that depend on layout, CSS, real events, Web APIs | Browser startup; needs a provider and browser binaries in CI |
| **Playwright E2E**        | Full app over HTTP              | Critical user journeys across pages, auth, backend              | Slowest; separate runner (`@playwright/test`), not Vitest     |
| **Type tests**            | `tsc` (static)                  | Public generic APIs, overloads, inference                       | Not executed; dynamic names stay unevaluated                   |

Vitest Browser Mode is **not** a replacement for an E2E runner. The Vitest docs recommend pairing it with Playwright, WebdriverIO, or Cypress for full-app flows.

## Decision Tree

```
What are you verifying?
├─ A type contract (generics, overloads)       → type test (*.test-d.ts)
├─ Logic with no DOM                            → node unit test
│   └─ Crosses a real boundary (DB, fs, HTTP)?  → node integration test (own project)
├─ UI component
│   ├─ Behavior only (render, click, text)     → jsdom/happy-dom is fine
│   └─ Layout, CSS, focus, scrolling, canvas,
│      real input events, browser-only APIs     → Browser Mode
└─ A user journey through the deployed app      → Playwright E2E (outside Vitest)
```

Push each check down to the cheapest layer that can catch the bug. If a jsdom test needs a stack of polyfills, such as `matchMedia`, `ResizeObserver`, or layout values, that's a signal to move the test to Browser Mode instead.

## Balancing the Suite

- **Many** fast node unit tests for branching logic and edge cases.
- **Enough** integration tests to prove the real wiring works. These catch the bugs that mocks hide.
- **Focused** component tests through user-facing queries (role, label, text), never internal state.
- **Few** E2E journeys: sign-in, checkout, and the paths that lose money when broken.

Whether you prefer a pyramid (unit-heavy) or a trophy (integration-heavy), the shared rule is the same: test the public contract, and mock only what is slow, nondeterministic, or outside your control. See [when-to-mock.md](when-to-mock.md).

## File Layout and Naming

The default `include` is `**/*.{test,spec}.?(c|m)[jt]s?(x)`. Both layouts below work:

```
# colocated (default recommendation: easy to find, moves with the code)
src/
  cart/
    cart.ts
    cart.test.ts
    CartView.tsx
    CartView.browser.test.tsx

# separate tree (common for integration/E2E or published packages)
src/cart/cart.ts
tests/unit/cart.test.ts
tests/integration/cart-db.test.ts
```

- Pick one convention per test type and encode it in `include` patterns. Don't depend on folder names alone.
- Use a suffix to mark the type: `*.integration.test.ts`, `*.browser.test.tsx`, `*.test-d.ts`.
- Split a test file that grows past a few hundred lines by feature (`userService.auth.test.ts`).
- Keep `describe` nesting to one or two levels.
- To give one file a different DOM environment without a new project, add `// @vitest-environment jsdom` at the top of the file.

## One Project per Test Type

Use `test.projects` so that each type gets the right environment, isolation, and setup. In 5.x, inline projects **inherit the root config by default** and share one Vite server:

```ts
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts'],
          exclude: ['**/*.integration.{test,spec}.ts'],
          isolate: false, // only if unit tests are free of shared state
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.{test,spec}.ts'],
          setupFiles: ['./test/setup-db.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.{test,spec}.tsx'],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
```

```bash
vitest run -p unit                  # 5.x shorthand for --project
vitest run --project=integration
```

- Give every project a `name`. Names must be unique.
- Arrays such as `setupFiles` are **appended** to inherited ones. Set `extends: false` on a project that must not inherit the root config.
- Keep Playwright E2E specs out of Vitest's `include`, for example under `e2e/` with a different suffix, so Vitest doesn't try to collect them.

More on projects: [projects.md](../core/projects.md).

## In-Source Tests

In-source tests sit in an `import.meta.vitest` block inside the module. They can reach private helpers without exporting them.

```ts
export function add(...args: number[]) {
  return args.reduce((a, b) => a + b, 0)
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('adds', () => {
    expect(add(1, 2, 3)).toBe(6)
  })
}
```

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { 'import.meta.vitest': 'undefined' }, // strip from production builds
  test: {
    includeSource: ['src/**/*.{js,ts}'],
  },
})
```

Use them for small pure utilities and prototyping only. The docs recommend separate files for anything larger, such as components or integration tests. Add `"types": ["vitest/importMeta"]` to `tsconfig.json` for typing.

## Type Tests

Use type tests when the **type** is the product: library APIs, generic helpers, and inferred return types.

```ts
import { assertType, expectTypeOf, test } from 'vitest'
import { mount } from './mount'

test('mount types', () => {
  expectTypeOf(mount).toBeFunction()
  expectTypeOf(mount).parameter(0).toExtend<{ name: string }>()
  // @ts-expect-error name must be a string
  assertType(mount({ name: 42 }))
})
```

Put them in `*.test-d.ts` files and run them with `vitest --typecheck` or `vitest run --typecheck.only`. They are analyzed by `tsc`, not executed. Runtime tests still need a separate `tsc --noEmit` step. See [type-testing.md](../testing-patterns/type-testing.md).

## Anti-Patterns to Avoid

| Anti-Pattern                                               | Problem                                                   | Solution                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Everything in `jsdom` "just in case"                       | Pays DOM setup on pure-logic files                        | Default to `node`; put DOM tests in their own project          |
| Polyfilling layout APIs to keep a test in jsdom            | Tests a fake browser and passes on broken CSS or layout   | Move the test to Browser Mode                                  |
| Using Browser Mode as an E2E runner                        | No full-app navigation or backend; wrong tool             | Playwright E2E for journeys                                    |
| E2E tests for every edge case                              | Slow, flaky, expensive feedback                           | Push edge cases to unit tests                                  |
| Mocking every collaborator in "integration" tests          | Proves nothing about the wiring                           | Use real dependencies at the boundary under test               |
| Mixing unit and DB tests in one project                    | Unit tests inherit slow setup; DB tests lose isolation    | Separate projects with their own `setupFiles`                  |
| Large in-source test blocks                                | Bloats modules; leaks into builds without `define`        | Separate test files                                            |
| Relying on `vitest run` to catch type errors               | Vitest strips types without checking them                 | `tsc --noEmit` and/or `--typecheck`                            |
| Asserting on component internals or private state         | Breaks on refactors without behavior change               | Query by role, label, or text; assert visible output           |

## Related References

- **Mock vs real dependency**: [when-to-mock.md](when-to-mock.md)
- **Projects and monorepos**: [projects.md](../core/projects.md)
- **DOM environments**: [dom-environments.md](../testing-patterns/dom-environments.md)
- **Browser Mode**: [browser-mode.md](../testing-patterns/browser-mode.md)
- **Component testing**: [component-testing.md](../testing-patterns/component-testing.md)
- **Integration tests with databases**: [integration-testing.md](../testing-patterns/integration-testing.md)
- **Type tests**: [type-testing.md](../testing-patterns/type-testing.md)
- **Speed trade-offs**: [performance.md](../infrastructure-ci-cd/performance.md)
