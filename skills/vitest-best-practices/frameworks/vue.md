# Vue Testing with Vitest

## Table of Contents

1. [Choosing a Setup](#choosing-a-setup)
2. [Configuration](#configuration)
3. [Rendering Components](#rendering-components)
4. [Props and Rerendering](#props-and-rerendering)
5. [Events and Emits](#events-and-emits)
6. [Slots](#slots)
7. [Plugins, Provide, Stubs](#plugins-provide-stubs)
8. [Async Updates](#async-updates)
9. [Mocking Modules](#mocking-modules)

## Choosing a Setup

| Setup                                       | Use when                                                         |
| ------------------------------------------- | ---------------------------------------------------------------- |
| Browser Mode + `vitest-browser-vue`         | Default for component tests. Real DOM, CSS, events, focus.       |
| `jsdom`/`happy-dom` + `@vue/test-utils` or `@testing-library/vue` | Existing suite; fast DOM-only checks. |

`vitest-browser-vue` wraps Vue Test Utils `mount` and returns locators that work with `expect.element` retries.

## Configuration

```bash
npm install -D vitest @vitest/browser-playwright vitest-browser-vue @vitejs/plugin-vue
# Yarn does not install peer deps: also `yarn add -D vite`
```

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

If the app config already includes `plugins: [vue()]`, reuse it with `mergeConfig` or put the `test` block in `vite.config.ts` so tests compile SFCs the same way the app does. See [configuration.md](../core/configuration.md).

## Rendering Components

**Version note (5.x):** `render` from `vitest-browser-vue` now returns a promise. Code written for 4.x as `const screen = render(Component)` must become `await render(Component)`.

```ts
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-vue'
import Counter from './Counter.vue'

test('increments the count', async () => {
  const screen = await render(Counter, {
    props: { initialCount: 1 },
  })

  await screen.getByRole('button', { name: 'Increment' }).click()

  await expect.element(screen.getByText('Count is 2')).toBeVisible()
})
```

`render(Component, options)` accepts all Vue Test Utils `mount` options except `attachTo` (use `container` instead), plus `container` and `baseElement`. The result exposes locators scoped to `baseElement`, plus `container`, `locator`, `debug`, `rerender`, `unmount`, `emitted`.

- Query by role, label, or text. Avoid `container.querySelector`.
- `locator` scopes queries to the component's container:

```ts
const { locator } = await render(NumberDisplay, { props: { number: 2 } })
await expect.element(locator.getByRole('status')).toHaveTextContent('2')
```

**Version note (5.x):** text locators are exact by default, and `toHaveTextContent` checks strict equality. Use `toMatchTextContent` for partial or RegExp matching.

## Props and Rerendering

Prefer testing the parent that changes the props. When you do need it, `rerender` takes a partial props object and is async:

```ts
const { rerender } = await render(NumberDisplay, { props: { number: 1 } })

await rerender({ number: 2 })

await expect.element(page.getByText('2')).toBeVisible()
```

(`page` comes from `vitest/browser`.)

Cover each prop's observable effect, defaults, and invalid/edge values (empty lists, long strings, `null`). Use `test.for` for prop tables:

```ts
test.for([
  { status: 'ok', label: 'Healthy' },
  { status: 'degraded', label: 'Degraded' },
  { status: 'down', label: 'Offline' },
])('status $status shows $label', async ({ status, label }) => {
  const screen = await render(StatusBadge, { props: { status } })
  await expect.element(screen.getByText(label)).toBeVisible()
})
```

## Events and Emits

The docs treat emitted values as an implementation detail: prefer asserting how they change the rendered output. When an emit *is* the component's public contract (a reusable input, a form), assert it. Either pass a listener prop or read `emitted()`:

```ts
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import SearchBox from './SearchBox.vue'

test('emits search with the trimmed query', async () => {
  const onSearch = vi.fn()
  const screen = await render(SearchBox, {
    props: { onSearch }, // Vue maps `onSearch` to the `search` event
  })

  await screen.getByRole('searchbox').fill('  vitest  ')
  await screen.getByRole('button', { name: 'Search' }).click()

  expect(onSearch).toHaveBeenCalledWith('vitest')
})

test('emitted() records every event', async () => {
  const screen = await render(SearchBox)
  await screen.getByRole('searchbox').fill('vue')
  await screen.getByRole('button', { name: 'Search' }).click()

  expect(screen.emitted('search')).toEqual([['vue']])
})
```

For `v-model`, interact through the input and assert on visible output or on the `update:modelValue` contract.

## Slots

Slots use the Vue Test Utils `slots` mount option. Assert on what renders, not on slot internals:

```ts
test('renders header and default slots', async () => {
  const screen = await render(Card, {
    slots: {
      header: '<h2>Settings</h2>',
      default: '<p>Body text</p>',
    },
  })

  await expect.element(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect.element(screen.getByText('Body text')).toBeVisible()
})
```

## Plugins, Provide, Stubs

Install app plugins (router, store, i18n) through the `global` mount option. Create a fresh instance per test so state doesn't leak:

```ts
// test/render.ts
import { render } from 'vitest-browser-vue'
import type { Component } from 'vue'
import { createI18nForTests } from './i18n'

export function renderWithApp(component: Component, options: Record<string, unknown> = {}) {
  return render(component, {
    ...options,
    global: {
      plugins: [createI18nForTests()],
      provide: { featureFlags: { newCheckout: true } },
    },
  })
}
```

For router- or store-specific testing helpers, follow those libraries' own docs; the Vitest docs don't cover them. Wrap per-test creation in a `test.extend` fixture when several tests share it (see [fixtures-hooks.md](../core/fixtures-hooks.md)).

Global Vue Test Utils config is available through `config` (in both `vitest-browser-vue` and `vitest-browser-vue/pure`):

```ts
// setup file
import { config } from 'vitest-browser-vue/pure'

config.global.stubs.CustomComponent = { template: '<div></div>' }
```

Stub heavy or third-party children sparingly. Every stub removes real integration coverage.

## Async Updates

Vue batches DOM updates. In Browser Mode you don't need `nextTick` before assertions: `expect.element` retries until the DOM matches.

```ts
test('shows results after search', async () => {
  const screen = await render(SearchPage)

  await screen.getByRole('searchbox').fill('vitest')
  await screen.getByRole('button', { name: 'Search' }).click()

  await expect.element(screen.getByRole('list')).toBeVisible()
  await expect.element(screen.getByText('No results')).not.toBeInTheDocument()
})
```

For non-DOM state, `await expect.poll(() => store.items.length).toBe(3)`. Mock HTTP at the network layer (MSW). See [network-requests.md](../mocking/network-requests.md).

## Mocking Modules

Browser Mode uses native ESM: `vi.spyOn` on an imported module namespace throws. Use `vi.mock(path, { spy: true })` to track calls with real behavior, or a factory to replace exports:

```ts
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import * as api from './api'
import UserList from './UserList.vue'

vi.mock(import('./api'), { spy: true })

test('renders users from the API', async () => {
  vi.mocked(api.fetchUsers).mockResolvedValue([{ id: 1, name: 'Ada' }])

  const screen = await render(UserList)

  await expect.element(screen.getByText('Ada')).toBeVisible()
  expect(api.fetchUsers).toHaveBeenCalledOnce()
})
```

- `vi.mock` must be at the top level (5.x throws otherwise).
- 5.0: automocked modules without a factory return `undefined` in the browser.
- 5.1: Vitest errors if a module was imported before `vi.mock` registered it.

See [module-mocking.md](../mocking/module-mocking.md).

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `const screen = render(C)` (4.x style) | 5.x returns a promise; queries hit nothing | `await render(C)` |
| `await nextTick()` before every assertion | Noise; still races async work | `await expect.element(...)` retries |
| Asserting `emitted()` for every interaction | Tests internals the user never sees | Assert rendered output; keep emits for public contracts |
| Shared router/store instance across tests | Navigation/state leaks between tests | Create per test via helper or fixture |
| Stubbing every child component | Tests pass while integration is broken | Stub only slow or external children |
| `attachTo` mount option | Not supported by `vitest-browser-vue` | Use `container` |
| `vi.spyOn(apiNamespace, 'fn')` in Browser Mode | Throws: sealed ESM namespace | `vi.mock(path, { spy: true })` |

## Related References

- [component-testing.md](../testing-patterns/component-testing.md) - component test patterns
- [browser-mode.md](../testing-patterns/browser-mode.md) - providers, locators, assertions
- [dom-environments.md](../testing-patterns/dom-environments.md) - jsdom/happy-dom setup
- [module-mocking.md](../mocking/module-mocking.md) - `vi.mock`, partial mocks
- [fixtures-hooks.md](../core/fixtures-hooks.md) - per-test app instances
- [migration.md](../architecture/migration.md) - 4.x → 5.x changes
