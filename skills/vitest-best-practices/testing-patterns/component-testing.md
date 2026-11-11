# Component Testing

## Table of Contents

1. [Approach](#approach)
2. [Setup](#setup)
3. [render Is Async](#render-is-async)
4. [Querying: Locators from render](#querying-locators-from-render)
5. [Testing User-Visible Behavior](#testing-user-visible-behavior)
6. [Props, Rerender, and Events](#props-rerender-and-events)
7. [Async Data and Loading States](#async-data-and-loading-states)
8. [Containers, Portals, and Wrappers](#containers-portals-and-wrappers)
9. [Cleanup](#cleanup)
10. [Frameworks Without a vitest-browser Package](#frameworks-without-a-vitest-browser-package)
11. [Node + DOM Environment Alternative](#node--dom-environment-alternative)

## Approach

Vitest's component testing guide recommends [Browser Mode](browser-mode.md): components render in a real browser with real CSS, events, and focus. Test the component's contract:

- **Inputs**: props, slots/children, context/providers.
- **Outputs**: what the user sees, plus callbacks/events the parent receives.
- **Interactions**: clicks, typing, keyboard navigation.
- **States**: loading, empty, error, disabled.

Don't assert on internal state, private methods, or CSS class names.

## Setup

Install the provider and the renderer for your framework, and add the framework's Vite plugin.

| Framework | Renderer | Install |
| --- | --- | --- |
| React | `vitest-browser-react` | `npm i -D vitest @vitest/browser-playwright vitest-browser-react` |
| Vue | `vitest-browser-vue` | `npm i -D vitest @vitest/browser-playwright vitest-browser-vue` |
| Svelte | `vitest-browser-svelte` | `npm i -D vitest @vitest/browser-playwright vitest-browser-svelte` |
| Angular, Lit, Preact, Qwik | `vitest-browser-angular`, `vitest-browser-lit`, `vitest-browser-preact`, `vitest-browser-qwik` | community packages listed in the Vitest docs |

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [vue()],
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

Framework details: [react.md](../frameworks/react.md), [vue.md](../frameworks/vue.md), [svelte.md](../frameworks/svelte.md).

## render Is Async

`render` returns a promise in all three official packages. **Await it** before querying.

```tsx
import { render } from 'vitest-browser-react'
const screen = await render(<Counter initialCount={1} />)
```

```ts
import { render } from 'vitest-browser-vue'
const screen = await render(Counter, { props: { initialCount: 1 } })
```

```ts
import { render } from 'vitest-browser-svelte'
const screen = await render(Counter, { initialCount: 1 }) // props directly, or { props: {...} }
```

**Version note (5.x):** `render` in `vitest-browser-vue` and `vitest-browser-svelte` became async with Vitest 5; `vitest-browser-react`'s `render` is async to support Suspense. `rerender` and `unmount` also return promises. Older examples that call `render(...)` without `await` are out of date.

## Querying: Locators from render

The render result exposes every [locator](browser-mode.md#locators-strict-by-default) (`getByRole`, `getByText`, ...) scoped to `baseElement` (default `document.body`), plus `locator` for the component's container.

```tsx
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { TodoList } from './TodoList'

test('adds a todo', async () => {
  const screen = await render(<TodoList />)

  await screen.getByLabelText('New todo').fill('Write tests')
  await screen.getByRole('button', { name: 'Add' }).click()

  await expect.element(screen.getByRole('listitem')).toHaveTextContent('Write tests')
})
```

- Assert with `await expect.element(locator)`: it retries until the component settles, even across rerenders.
- `screen.locator` scopes queries to the component's container: `screen.locator.getByRole('button')`.
- Avoid `container.querySelector(...)`. The package docs call this out explicitly: locators are more resilient to markup changes.
- Locators match text exactly by default in 5.x. Use a RegExp for partial text.

## Testing User-Visible Behavior

```tsx
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { ContactForm } from './ContactForm'

test('shows validation errors, then submits', async () => {
  const onSubmit = vi.fn()
  const screen = await render(<ContactForm onSubmit={onSubmit} />)
  const submit = screen.getByRole('button', { name: 'Send' })

  await submit.click()
  await expect.element(screen.getByText('Email is required')).toBeVisible()
  expect(onSubmit).not.toHaveBeenCalled()

  await screen.getByLabelText('Email').fill('ada@example.com')
  await submit.click()

  await expect.element(screen.getByText('Email is required')).not.toBeInTheDocument()
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ email: 'ada@example.com' })
})

test('dialog closes on Escape and returns focus', async () => {
  const screen = await render(<SettingsDialogTrigger />)
  const trigger = screen.getByRole('button', { name: 'Settings' })

  await trigger.click()
  await expect.element(page.getByRole('dialog')).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
```

Name tests by behavior ("shows error when email is invalid"), not implementation ("calls validateEmail").

## Props, Rerender, and Events

Prefer testing the parent that changes props. When you need to drive props directly, use `rerender` and await it.

```ts
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-vue'
import Badge from './Badge.vue'

test('updates when the count prop changes', async () => {
  const screen = await render(Badge, { props: { count: 1 } })
  await expect.element(screen.getByRole('status')).toHaveTextContent('1 new')

  await screen.rerender({ count: 5 })
  await expect.element(screen.getByRole('status')).toHaveTextContent('5 new')
})
```

Outputs to the parent:

- **React / Svelte callbacks**: pass `vi.fn()` as a prop and assert calls.
- **Vue events**: pass a handler prop (`onSelect: vi.fn()`) and assert calls. `screen.emitted()` exists, but the `vitest-browser-vue` docs flag emitted values as an implementation detail. Prefer asserting what the user sees.

## Async Data and Loading States

`expect.element` retries, so assert each state in order. Mock HTTP at the network layer (MSW) rather than mocking fetch helpers when possible.

```tsx
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { UserProfile } from './UserProfile'

test('shows loading, then the user', async () => {
  const screen = await render(<UserProfile userId="123" />)

  await expect.element(screen.getByText('Loading…')).toBeVisible()
  await expect.element(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible()
})
```

MSW setup for the browser and per-test handler overrides: [network-requests.md](../mocking/network-requests.md). Module mocks in Browser Mode have limits (no `vi.spyOn` on module namespaces; use `vi.mock(path, { spy: true })`): see [browser-mode.md](browser-mode.md#mocking-limitations).

## Containers, Portals, and Wrappers

- **Custom container**: for elements that can't live in a `div` (e.g. `<tbody>`), pass `container` (React/Vue) or `target` (Svelte). You must append it to `document.body` yourself.
- **Portals**: queries search `baseElement` (default `document.body`), so content rendered outside the container is still found.
- **Providers** (React): pass `wrapper`, or build a `renderWithProviders` helper.

```tsx
import { render } from 'vitest-browser-react'

export function renderWithProviders(ui: React.ReactNode) {
  return render(ui, { wrapper: ({ children }) => <ThemeProvider theme="light">{children}</ThemeProvider> })
}

const table = document.createElement('table')
const screen = await render(<Rows items={items} />, { container: document.body.appendChild(table) })
```

- **Vue global config** (stubs, plugins): `config` from `vitest-browser-vue/pure`, or `global` in render options (all `@vue/test-utils` `mount` options except `attachTo`).

## Cleanup

The default entry points of `vitest-browser-react`, `vitest-browser-vue`, and `vitest-browser-svelte` remove rendered components before the next test starts. Their `/pure` entry points do not; call `cleanup()` yourself if you use them. Every package also exports `cleanup()` to remove all rendered components on demand.

```ts
import { afterEach } from 'vitest'
import { cleanup, render } from 'vitest-browser-react/pure'

afterEach(async () => {
  await cleanup()
})
```

Other state still leaks between tests in a file: global stores, `localStorage`, MSW handlers, hover/pointer state. Reset it in `afterEach` or with fixtures.

## Frameworks Without a vitest-browser Package

Render with the framework's Testing Library package, then bridge to Vitest locators with `page.elementLocator`:

```tsx
import { render } from '@solidjs/testing-library'
import { expect, test } from 'vitest'
import { page } from 'vitest/browser'

test('increments', async () => {
  const { baseElement } = render(() => <Counter initialValue={0} />)
  const screen = page.elementLocator(baseElement)

  await screen.getByRole('button', { name: /increment/i }).click()
  await expect.element(screen.getByText('Count: 1')).toBeInTheDocument()
})
```

Use `userEvent` from `vitest/browser`, not `@testing-library/user-event`.

## Node + DOM Environment Alternative

Running components in `jsdom`/`happy-dom` with a Testing Library package is faster to start but has no real layout, CSS, or browser events. It is reasonable for existing suites and logic-heavy components. The Vitest docs note that `@testing-library/react` relies on globals for automatic cleanup, so either enable `globals: true` or call its `cleanup` in `afterEach`. Environment setup: [dom-environments.md](dom-environments.md). Move tests to Browser Mode when they depend on layout, focus, or real events.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `const screen = render(...)` without `await` | Queries run before mount; async in all official packages | `await render(...)` |
| `container.querySelector('.btn-primary')` | Coupled to markup and class names | `screen.getByRole('button', { name })` |
| `expect(locator).toBeVisible()` | No retry; flaky on async updates | `await expect.element(locator)...` |
| Asserting component state or hooks internals | Breaks on refactor; misses user-visible bugs | Assert rendered output and callbacks |
| Asserting `emitted()` payloads only | Implementation detail per the package docs | Assert the visible result or a handler prop |
| Mocking every child component | Tests wiring, not behavior | Mock only slow or external dependencies |
| `/pure` import without `cleanup` | Components from earlier tests remain in the DOM | Default entry point, or `afterEach(cleanup)` |
| `@testing-library/user-event` in Browser Mode | Simulated events | `userEvent` / locator methods from `vitest/browser` |
| Many `rerender` calls to simulate a parent | Tests props wiring instead of real usage | Render the parent, or a small test harness component |

## Related References

- **Browser Mode setup, locators, assertions**: [browser-mode.md](browser-mode.md)
- **Framework specifics**: [react.md](../frameworks/react.md), [vue.md](../frameworks/vue.md), [svelte.md](../frameworks/svelte.md)
- **HTTP mocking with MSW**: [network-requests.md](../mocking/network-requests.md)
- **Module mocks**: [module-mocking.md](../mocking/module-mocking.md)
- **DOM environment alternative**: [dom-environments.md](dom-environments.md)
- **Visual and ARIA snapshots**: [snapshots.md](snapshots.md)
