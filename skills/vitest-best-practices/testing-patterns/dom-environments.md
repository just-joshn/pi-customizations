# DOM Environments (jsdom, happy-dom)

## Table of Contents

1. [What an Environment Is](#what-an-environment-is)
2. [Choosing node, jsdom, or happy-dom](#choosing-node-jsdom-or-happy-dom)
3. [Setting the Environment](#setting-the-environment)
4. [Per-File Environment Comments](#per-file-environment-comments)
5. [environmentOptions](#environmentoptions)
6. [Globals, window, and Missing APIs](#globals-window-and-missing-apis)
7. [Cleanup Between Tests](#cleanup-between-tests)
8. [Performance](#performance)
9. [When to Move to Browser Mode](#when-to-move-to-browser-mode)

## What an Environment Is

`environment` decides which globals exist while a test file runs in Node.js. The default is `node`. `jsdom` and `happy-dom` add simulated browser globals (`window`, `document`, `HTMLElement`, ...). `edge-runtime` emulates Vercel's edge runtime. Install the package you use (`jsdom` or `happy-dom`) as a dev dependency.

Environments exist only for Node.js runs. Browser Mode is not an environment; it runs tests in a real browser ([browser-mode.md](browser-mode.md)).

## Choosing node, jsdom, or happy-dom

| Environment | Use for | Trade-off |
| --- | --- | --- |
| `node` (default) | Server code, pure logic, CLIs | No DOM globals |
| `happy-dom` | Fast DOM unit tests, simple components | Cheaper to create than jsdom; lacks some APIs |
| `jsdom` | DOM tests that need broader spec coverage | Slower to create than happy-dom |
| Browser Mode | Layout, CSS, real events, focus, browser APIs | Slower startup; needs a provider |

Simulated DOMs implement no layout engine and no real rendering. Anything that depends on sizes, positions, computed CSS, scrolling, or real event dispatch can pass in jsdom/happy-dom and fail in a browser, or the other way around.

Keep the default `node` for everything that doesn't touch the DOM, and opt in only the files that need one.

## Setting the Environment

Project-wide in config:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom', // 'node' | 'jsdom' | 'happy-dom' | 'edge-runtime' | custom
  },
})
```

Or on the CLI: `vitest --environment=jsdom`.

Mixed suites are better expressed as [projects](../core/projects.md), so server tests stay on `node`:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', include: ['src/server/**/*.{test,spec}.ts'], environment: 'node' } },
      { test: { name: 'dom', include: ['src/ui/**/*.{test,spec}.{ts,tsx}'], environment: 'happy-dom' } },
    ],
  },
})
```

In 5.x inline projects inherit the root config by default (`extends: true`), so options like plugins and `setupFiles` set at the root apply to both projects.

## Per-File Environment Comments

A `@vitest-environment` comment at the top of the file overrides the configured environment for that file. Both docblock and line-comment styles work; `@jest-environment` is also accepted for Jest compatibility.

```ts
// @vitest-environment jsdom
import { expect, test } from 'vitest'

test('creates an element', () => {
  const el = document.createElement('div')
  el.textContent = 'hi'
  expect(el.outerHTML).toBe('<div>hi</div>')
})
```

```ts
/**
 * @vitest-environment happy-dom
 */
```

Use this for a few DOM files in a mostly-`node` project. If many files need it, use a project instead.

## environmentOptions

Options are passed to the environment's setup, scoped by environment key: `jsdom` for jsdom, `happyDOM` for happy-dom.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost:3000' }, // sets location / origin
      happyDOM: { width: 1280, height: 720 },
    },
  },
})
```

The jsdom environment also exposes a `jsdom` global (the current `JSDOM` instance). Add `"vitest/jsdom"` to `compilerOptions.types` to type it.

## Globals, window, and Missing APIs

Simulated DOMs lack some browser APIs (for example, jsdom has no `IntersectionObserver` or `ResizeObserver`). Stub what the code under test needs with `vi.stubGlobal`, and restore with `vi.unstubAllGlobals()` or the `unstubGlobals: true` config option.

```ts
import { afterEach, expect, test, vi } from 'vitest'
import { lazyLoad } from './lazy'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('observes the image', () => {
  const observe = vi.fn()
  vi.stubGlobal('IntersectionObserver', vi.fn(class {
    observe = observe
    disconnect = vi.fn()
  }))

  lazyLoad(document.createElement('img'))

  expect(observe).toHaveBeenCalledOnce()
})
```

In jsdom/happy-dom, `vi.stubGlobal` also sets the value on `window`, `top`, `self`, and `parent`, and `vi.unstubAllGlobals()` restores those too. Plain assignment (`window.innerWidth = 500`) works but can't be undone by `unstubAllGlobals`.

**Version note (5.0):** assignments to `globalThis` or `window` properties now propagate to the underlying DOM implementation. Mutable values like `innerWidth` can therefore affect APIs implemented by the environment (for example happy-dom's `matchMedia`). Tests that relied on assignments being "cosmetic" may behave differently after upgrading. Prefer `vi.stubGlobal` with automatic unstubbing.

Mocking globals in depth: [globals-env.md](../mocking/globals-env.md).

## Cleanup Between Tests

The environment is created per test file (with default isolation), but the DOM is **shared by all tests in a file**. Reset what your tests add.

```ts
import { afterEach } from 'vitest'

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})
```

Some component libraries register their own cleanup through global `afterEach`. The Vitest docs note that `@testing-library/react`, for example, relies on globals being present (`globals: true`) to auto-clean up. Without `globals`, call the library's cleanup yourself in `afterEach`.

## Performance

DOM environments are expensive to create: per the Vitest docs, roughly 200–500 ms to import jsdom and 90–200 ms for happy-dom, plus window construction. With isolation on (the default), that cost is paid per test file. It shows up as the `environment` share of the run's duration breakdown.

| Configuration | Environment created | Trade-off |
| --- | --- | --- |
| default (`forks`/`threads`, `isolate: true`) | once per file | Safest, slowest |
| `pool: 'vmThreads'` | once per worker, fresh `window` per file | VM realm: cross-realm `instanceof` edge cases; memory reclaimed less reliably |
| `isolate: false` | once per worker, shared across files | Files share `window` and module state; tests must clean up |

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    pool: 'vmThreads', // environment per worker, fresh window per file
  },
})
```

Also: keep DOM tests to the files that need them (per-file comments or projects), and prefer `happy-dom` when it supports what you use. See [performance.md](../infrastructure-ci-cd/performance.md).

## When to Move to Browser Mode

Move a test to [Browser Mode](browser-mode.md) when it:

- depends on layout, sizes, scroll positions, or computed styles
- tests focus management, keyboard navigation, or real pointer/hover behavior
- uses browser APIs the simulators lack or emulate poorly (canvas, Web Components edge cases, `IntersectionObserver` behavior)
- keeps needing stubs to pretend to be a browser
- passed in jsdom but the bug reproduced in a real browser

The Vitest docs recommend Browser Mode for component testing. A common split: pure logic in `node`, light DOM utilities in `happy-dom`, components and interaction in Browser Mode.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `environment: 'jsdom'` for the whole repo | Every server test pays DOM setup cost and sees fake `window` | Default `node`; per-file comment or a DOM project |
| Asserting layout (`getBoundingClientRect`, `offsetWidth`) in jsdom | No layout engine; values are zeros or stubs | Browser Mode |
| `window.innerWidth = 500` without restoring | In 5.x it changes the DOM implementation and leaks | `vi.stubGlobal('innerWidth', 500)` + `unstubGlobals` |
| Not clearing `document.body` between tests | Earlier tests' DOM breaks later queries | `afterEach` cleanup or library cleanup |
| Stubbing many browser APIs to make a component render | Testing a fake browser, not the component | Browser Mode |
| `isolate: false` with tests that mutate `window` | State leaks across files in the same worker | Keep isolation, or `pool: 'vmThreads'` |
| Putting jsdom options at the top level of `environmentOptions` | Options are scoped by environment key | `environmentOptions: { jsdom: {...} }` / `{ happyDOM: {...} }` |

## Related References

- **Real browser tests**: [browser-mode.md](browser-mode.md)
- **Component tests**: [component-testing.md](component-testing.md)
- **Stubbing globals and env**: [globals-env.md](../mocking/globals-env.md)
- **Projects for mixed environments**: [projects.md](../core/projects.md)
- **Pools, isolation, speed**: [performance.md](../infrastructure-ci-cd/performance.md)
- **Choosing the test level**: [test-architecture.md](../architecture/test-architecture.md)
