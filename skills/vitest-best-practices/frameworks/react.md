# React Testing with Vitest

## Table of Contents

1. [Choosing a Setup](#choosing-a-setup)
2. [Configuration](#configuration)
3. [Rendering Components](#rendering-components)
4. [User Interaction](#user-interaction)
5. [Async State and Suspense](#async-state-and-suspense)
6. [Providers and Wrappers](#providers-and-wrappers)
7. [Testing Hooks](#testing-hooks)
8. [Mocking Modules in React Apps](#mocking-modules-in-react-apps)
9. [Rerender, Unmount, Strict Mode](#rerender-unmount-strict-mode)

## Choosing a Setup

| Setup                                         | Use when                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Browser Mode + `vitest-browser-react`         | Default for component tests. Real DOM, CSS, focus, events.               |
| `jsdom`/`happy-dom` + `@testing-library/react` | Existing suite already uses it; fast feedback without a browser.         |

Vitest's component testing guide recommends Browser Mode. `vitest-browser-react` returns locators that work with `expect.element` retries, so assertions survive rerenders. If you keep `@testing-library/react` in a DOM environment, note that it relies on `globals: true` for automatic cleanup between tests.

## Configuration

Install the provider, the renderer, and the React Vite plugin:

```bash
npm install -D vitest @vitest/browser-playwright vitest-browser-react @vitejs/plugin-react
# Yarn does not install peer deps: also `yarn add -D vite`
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

To keep node-only unit tests out of the browser, split into [projects](../core/projects.md) (one `environment: 'node'`, one with `browser.enabled`).

## Rendering Components

`render` is **async** in `vitest-browser-react` (it supports `Suspense`). Always `await` it.

```tsx
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import Counter from './Counter'

test('increments the count', async () => {
  const screen = await render(<Counter count={1} />)

  await screen.getByRole('button', { name: 'Increment' }).click()

  await expect.element(screen.getByText('Count is 2')).toBeVisible()
})
```

The result exposes all [locators](../testing-patterns/browser-mode.md) scoped to `baseElement` (default `document.body`), plus `container`, `locator`, `debug`, `rerender`, `unmount`, `asFragment`.

- Query with `getByRole`, `getByLabelText`, `getByText`, then `getByTestId` as a last resort.
- Don't query through `container.querySelector`; the docs warn against it.
- Use `locator` to scope queries to the component's own container:

```tsx
const { locator } = await render(<NumberDisplay number={1} />)
await expect.element(locator.getByRole('status')).toHaveTextContent('1')
```

When a component must render inside a specific parent (e.g. a `<tbody>`), pass a container and append it yourself:

```tsx
const table = document.createElement('table')
await render(<TableBody rows={rows} />, {
  container: document.body.appendChild(table),
})
```

**Version note (5.x):** locators match text exactly by default (`browser.locators.exact`), and `toHaveTextContent` checks strict equality. Use `toMatchTextContent` for substring or RegExp matching.

```tsx
import { page } from 'vitest/browser'

await expect.element(page.getByRole('alert')).toHaveTextContent('Saved!')
await expect.element(page.getByRole('alert')).toMatchTextContent(/saved/i)
```

## User Interaction

Use locator methods or `userEvent` from `vitest/browser`. They drive real browser events via CDP/WebDriver. Don't use `@testing-library/user-event`; it simulates events.

```tsx
import { expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import LoginForm from './LoginForm'

test('submits credentials', async () => {
  const onSubmit = vi.fn()
  const screen = await render(<LoginForm onSubmit={onSubmit} />)

  await screen.getByLabelText('Email').fill('ada@example.com')
  await screen.getByLabelText('Password').fill('secret')
  await userEvent.keyboard('{Enter}')

  await expect.poll(() => onSubmit.mock.calls.length).toBe(1)
  expect(onSubmit).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'secret' })
})
```

Prefer asserting on what the user sees over asserting on callbacks, unless the callback is the component's contract.

## Async State and Suspense

`expect.element(locator)` retries until the assertion passes or times out. Use it for anything that appears after an effect, fetch, or transition. No manual sleeps.

```tsx
test('shows the user after loading', async () => {
  const screen = await render(<UserProfile id="1" />)

  await expect.element(screen.getByText('Loading...')).toBeVisible()
  await expect.element(screen.getByRole('heading', { name: 'Ada' })).toBeVisible()
  await expect.element(screen.getByText('Loading...')).not.toBeInTheDocument()
})
```

For non-DOM conditions, use `expect.poll` or `vi.waitFor` and `await` them. **Version note (5.x):** an unawaited `expect.poll`, `.resolves`, or `.rejects` fails the test.

For network-backed components, mock at the network layer (MSW) rather than stubbing `fetch` per component. See [network-requests.md](../mocking/network-requests.md).

## Providers and Wrappers

Use the `wrapper` option for context providers, and build a project-level `renderWithProviders` helper:

```tsx
// test/render.tsx
import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'
import { ThemeProvider } from '../src/theme'
import { I18nProvider } from '../src/i18n'

function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme="light">
      <I18nProvider locale="en">{children}</I18nProvider>
    </ThemeProvider>
  )
}

export function renderWithProviders(ui: ReactNode) {
  return render(ui, { wrapper: Providers })
}
```

Create stateful providers (query clients, stores, routers) **inside** the helper or a test fixture so each test gets a fresh instance. A module-level store shared across tests is a common source of order-dependent failures. Combine with `test.extend` for per-test instances (see [fixtures-hooks.md](../core/fixtures-hooks.md)).

## Testing Hooks

`renderHook` exists, but the docs recommend testing hooks through a small test component with `render`, since that keeps the behavior visible. Reach for `renderHook` mainly when publishing a hook library.

```tsx
import { expect, test } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { useCounter } from './useCounter'

test('starts from the initial value', async () => {
  const { result } = await renderHook(
    (props: { initial: number } = { initial: 0 }) => useCounter(props.initial),
    { initialProps: { initial: 5 } },
  )
  expect(result.current.count).toBe(5)
})
```

- `result.current` holds the latest committed return value.
- `renderHook`, `rerender`, and `unmount` are async; await them.
- `initialProps` are not passed to `wrapper`. To give the wrapper props, close over them in a wrapper factory.

## Mocking Modules in React Apps

Browser Mode serves native ESM, so the module namespace is sealed: `vi.spyOn(module, 'fn')` on an imported namespace **throws**. Use `vi.mock` with `{ spy: true }` to spy on exports while keeping their implementation, or a factory to replace them.

```tsx
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import * as analytics from './analytics'
import SignupButton from './SignupButton'

vi.mock(import('./analytics'), { spy: true })

test('tracks signup clicks', async () => {
  vi.mocked(analytics.track).mockImplementation(() => {})
  const screen = await render(<SignupButton />)

  await screen.getByRole('button', { name: 'Sign up' }).click()

  expect(analytics.track).toHaveBeenCalledWith('signup_clicked')
})
```

- `vi.mock` is hoisted and must be at the top level of the file (5.x throws otherwise). Reference outer values via `vi.hoisted`.
- **Version note (5.0):** automocked modules (`vi.mock(path)` without factory) now return `undefined` from exports in the browser too. Use `{ spy: true }` to keep real behavior.
- **Version note (5.1):** with import-map mocking, Vitest errors if the module was imported before `vi.mock` registered it, and a factory can only provide exports the original module declares.
- Mock child components sparingly. Rendering the real tree catches integration bugs; mock only what's slow, nondeterministic, or out of your control. See [module-mocking.md](../mocking/module-mocking.md) and [when-to-mock.md](../architecture/when-to-mock.md).

## Rerender, Unmount, Strict Mode

```tsx
const { rerender, unmount } = await render(<NumberDisplay number={1} />)
await rerender(<NumberDisplay number={2} />)
await expect.element(page.getByText('2')).toBeVisible()

await unmount() // verify cleanup: listeners, timers, subscriptions
```

(`page` comes from `vitest/browser`.) The default entry unmounts components before the next test. `vitest-browser-react/pure` skips that and also exports `configure`:

```ts
// setup file
import { configure } from 'vitest-browser-react/pure'

configure({ reactStrictMode: true }) // off by default
```

Enable Strict Mode to catch effects that don't clean up. Pair with `detectAsyncLeaks` when hunting leaked timers (see [flaky-tests.md](../debugging/flaky-tests.md)).

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `const screen = render(<C />)` without `await` | Queries run before the component (or Suspense) settles | `const screen = await render(<C />)` |
| `expect(el.textContent).toBe(...)` right after a click | No retry; flaky on async updates | `await expect.element(locator).toHaveTextContent(...)` |
| `@testing-library/user-event` in Browser Mode | Simulated events, not real ones | `userEvent` from `vitest/browser` or locator methods |
| `vi.spyOn(moduleNamespace, 'fn')` in Browser Mode | Throws: ESM namespace is sealed | `vi.mock(path, { spy: true })` |
| `vi.mock` inside `describe`/`test` | Throws in 5.x; hoisted anyway | Move to top level; use `vi.hoisted` for values |
| Querying via `container.querySelector` | Couples tests to DOM structure | Role/label/text locators |
| Module-level store/query client shared by tests | Order-dependent state leaks | Create per test in a wrapper or fixture |
| `renderHook` for app hooks by default | Hides behavior behind an abstraction | Render a small component that uses the hook |
| `toHaveTextContent(/regex/)` | RegExp no longer accepted in 5.x | `toMatchTextContent(/regex/)` |

## Related References

- [component-testing.md](../testing-patterns/component-testing.md) - framework-agnostic component test patterns
- [browser-mode.md](../testing-patterns/browser-mode.md) - providers, locators, assertions
- [dom-environments.md](../testing-patterns/dom-environments.md) - jsdom/happy-dom setup
- [module-mocking.md](../mocking/module-mocking.md) - `vi.mock`, `vi.hoisted`, partial mocks
- [network-requests.md](../mocking/network-requests.md) - MSW for fetch-driven components
- [async-testing.md](../core/async-testing.md) - `expect.poll`, `vi.waitFor`
- [debugging.md](../debugging/debugging.md) - trace view and browser debugging
