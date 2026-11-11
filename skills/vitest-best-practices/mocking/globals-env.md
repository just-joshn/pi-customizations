# Globals and Environment Variables

## Table of Contents

1. [Stubbing Globals](#stubbing-globals)
2. [Restoring Globals](#restoring-globals)
3. [Browser APIs Missing from jsdom/happy-dom](#browser-apis-missing-from-jsdomhappy-dom)
4. [window.location and URLs](#windowlocation-and-urls)
5. [Environment Variables](#environment-variables)
6. [Static Env Values for All Tests](#static-env-values-for-all-tests)
7. [Spying on Existing Globals](#spying-on-existing-globals)

## Stubbing Globals

`vi.stubGlobal(name, value)` sets a value on `globalThis` (and on `window`, `self`, `top`, `parent` in jsdom/happy-dom), and records the original so it can be restored.

```ts
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('uses the injected version', () => {
  vi.stubGlobal('__APP_VERSION__', '1.0.0')
  expect(renderFooter()).toContain('v1.0.0')
})

test('responsive layout at 320px', () => {
  vi.stubGlobal('innerWidth', 320)
  expect(isMobile()).toBe(true)
})
```

You can also assign directly (`globalThis.innerWidth = 100`), but then `vi.unstubAllGlobals()` can't restore it; you must undo it yourself.

**Version note:** in 5.x jsdom/happy-dom environments, assignments to `globalThis`/`window` properties propagate to the underlying DOM implementation, so stubbing values like `innerWidth` can affect DOM APIs that read them (for example happy-dom's `matchMedia`).

## Restoring Globals

Stubs persist across tests until restored. Neither globals nor envs are restored by default:

| Config | Default | Effect |
| --- | --- | --- |
| `unstubGlobals` | `false` | Calls `vi.unstubAllGlobals()` before each test |
| `unstubEnvs` | `false` | Calls `vi.unstubAllEnvs()` before each test |

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    unstubGlobals: true,
    unstubEnvs: true,
  },
})
```

Prefer enabling both in config over remembering `afterEach` in every file. Like `clearMocks`, they act on the whole worker and can interfere with `test.concurrent` tests that stub the same name.

A global that didn't exist before the stub is removed again on unstub (`'IntersectionObserver' in globalThis === false`).

## Browser APIs Missing from jsdom/happy-dom

DOM environments don't implement everything. Stub missing constructors with a class-based `vi.fn` so `new` works and each instance gets its own mocks:

```ts
import { beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', vi.fn(class {
    disconnect = vi.fn()
    observe = vi.fn()
    takeRecords = vi.fn(() => [])
    unobserve = vi.fn()
  }))

  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})
```

Assert on what the component did with them:

```ts
test('observes the sentinel element', () => {
  mountInfiniteList(document.body)
  const Observer = vi.mocked(IntersectionObserver)
  const observer = Observer.mock.instances[0]
  expect(observer.observe).toHaveBeenCalledWith(expect.any(HTMLElement))
})
```

If a test needs real layout, observers, or media queries, use Browser Mode instead of stubbing.

## window.location and URLs

In jsdom the default URL is `http://localhost:3000/`. Options, from least to most invasive:

1. Set the starting URL per project with `environmentOptions`:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'https://app.example.com/dashboard' },
    },
  },
})
```

2. Change path and query in a test with the History API (same origin only):

```ts
test('reads the filter from the query string', () => {
  window.history.pushState({}, '', '/items?filter=open')
  expect(getFilter()).toBe('open')
})
```

3. Replace `location` entirely when you need a different origin or to observe navigation:

```ts
test('redirects to login', () => {
  const assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })

  requireAuth()

  expect(assign).toHaveBeenCalledWith('/login')
})
```

Restore with `vi.unstubAllGlobals()` (or `unstubGlobals: true`).

## Environment Variables

`vi.stubEnv(name, value)` changes both `process.env` and `import.meta.env`. Passing `undefined` removes the variable. `PROD`, `DEV`, and `SSR` take booleans.

```ts
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
})

test('uses the production API in prod', () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VITE_API_URL', 'https://api.example.com')
  expect(apiBase()).toBe('https://api.example.com')
})

test('falls back when the variable is unset', () => {
  vi.stubEnv('VITE_API_URL', undefined)
  expect(apiBase()).toBe('http://localhost:8080')
})

test('feature only in production builds', () => {
  vi.stubEnv('PROD', true)
  expect(showDebugPanel()).toBe(false)
})
```

`vi.unstubAllEnvs()` restores the values from before the **first** `stubEnv` call, even after several stubs of the same name.

Assigning (`import.meta.env.VITE_ENV = 'staging'`, `process.env.X = 'y'`) also works but is not restored by `unstubAllEnvs`. Save and restore the original yourself if you do this.

### Module-load-time reads

Code that reads env at import time (`const BASE = process.env.API_URL` at module top level) captures the value once. Stubbing in a test is too late for a static import. Either read the variable inside a function, or stub then re-import:

```ts
test('picks up API_URL at load time', async () => {
  vi.stubEnv('API_URL', 'https://staging.example.com')
  vi.resetModules()
  const { BASE } = await import('./config.js')
  expect(BASE).toBe('https://staging.example.com')
})
```

## Static Env Values for All Tests

Values every test needs belong in config, not stubs:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      API_URL: 'http://localhost:8080',
    },
  },
})
```

`test.env` values are set on `process.env` and `import.meta.env` inside test workers, not in the main process (`globalSetup` doesn't see them). Setting `TZ` here does not change the time zone in `threads`/`vmThreads` pools; see [timers-dates.md](timers-dates.md#time-zones).

## Spying on Existing Globals

To observe or override a method on an existing global object (not replace the whole global), use `vi.spyOn`:

```ts
test('logs a warning', () => {
  using warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  loadConfig({ legacy: true })
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('deprecated'))
})

test('random id is deterministic', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  expect(makeId()).toBe('id-5')
})
```

Restore spies with `mockRestore`, `using`, or `restoreMocks: true`. For `Date`, use fake timers or `vi.setSystemTime` instead of spying on `Date.now`. For `fetch`, prefer MSW.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `globalThis.X = ...` without cleanup | Leaks into later tests in the same file | `vi.stubGlobal` + `unstubGlobals: true` |
| `process.env.X = ...` in a test | Not restored; order-dependent failures | `vi.stubEnv` + `unstubEnvs: true` |
| Assuming stubs reset automatically | `unstubGlobals`/`unstubEnvs` default to `false` | Enable them in config or unstub in `afterEach` |
| Stubbing env after a static import that reads it | Value already captured | Read lazily, or `vi.resetModules()` + dynamic import |
| Arrow function as a stubbed constructor | `new` throws "is not a constructor" | `vi.fn(class { ... })` |
| Stubbing large browser surfaces in jsdom | Fake behavior diverges from browsers | Browser Mode for real layout/observers |
| `vi.spyOn(Date, 'now')` | Misses `new Date()` and timers | `vi.useFakeTimers()` / `vi.setSystemTime()` |
| Stubbing `fetch` by hand for many endpoints | Brittle, misses request details | MSW handlers |

## Related References

- **Fake time and dates**: See [timers-dates.md](timers-dates.md)
- **HTTP mocking**: See [network-requests.md](network-requests.md)
- **Spies and class mocks**: See [mock-functions.md](mock-functions.md)
- **jsdom / happy-dom setup**: See [dom-environments.md](../testing-patterns/dom-environments.md)
- **Real browser instead of stubs**: See [browser-mode.md](../testing-patterns/browser-mode.md)
- **Config options**: See [configuration.md](../core/configuration.md)
