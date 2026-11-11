# Svelte Testing with Vitest

## Table of Contents

1. [Choosing a Setup](#choosing-a-setup)
2. [Configuration](#configuration)
3. [Rendering Components](#rendering-components)
4. [Props and Rerendering](#props-and-rerendering)
5. [Callback Props and Events](#callback-props-and-events)
6. [Testing Snippets](#testing-snippets)
7. [Async Updates](#async-updates)
8. [Mocking Modules](#mocking-modules)

## Choosing a Setup

| Setup                                         | Use when                                                     |
| --------------------------------------------- | ------------------------------------------------------------ |
| Browser Mode + `vitest-browser-svelte`        | Default for component tests. Real DOM, CSS, events, focus.   |
| `jsdom`/`happy-dom` + `@testing-library/svelte` | Existing suite; fast DOM-only checks.                       |

`vitest-browser-svelte` wraps Svelte's `mount` and returns locators that work with `expect.element` retries.

## Configuration

```bash
npm install -D vitest @vitest/browser-playwright vitest-browser-svelte @sveltejs/vite-plugin-svelte
# Yarn does not install peer deps: also `yarn add -D vite`
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [svelte()],
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

The Svelte plugin populates dependency optimization for you (`deps.optimizer`), so don't hand-tune it unless you hit a resolution error. In a SvelteKit project, reuse the app's Vite config so tests compile components the same way. See [configuration.md](../core/configuration.md).

## Rendering Components

**Version note (5.x):** `render` from `vitest-browser-svelte` now returns a promise. Code written for 4.x as `const screen = render(Component)` must become `await render(Component)`.

Pass props directly as the second argument (or under `props`, as with Svelte's `mount` options):

```ts
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-svelte'
import Counter from './Counter.svelte'

test('increments the count', async () => {
  const screen = await render(Counter, { initialCount: 1 })

  await screen.getByRole('button', { name: 'Increment' }).click()

  await expect.element(screen.getByText('Count is 2')).toBeVisible()
})
```

`render(Component, options?, renderOptions?)`:

- `options`: props, or Svelte `mount` options such as `props` and `target`.
- `renderOptions` (third argument): `baseElement`. Rarely needed.

The result exposes locators scoped to `baseElement`, plus `container`, `component`, `locator`, `debug`, `rerender`, `unmount`.

- Query by role, label, or text. Avoid `container.querySelector`.
- `component` is the mounted instance. Reach for it only when a component's exports are its public API.

When the component must live inside a specific parent, pass `target` and append it yourself:

```ts
const table = document.createElement('table')
await render(TableBody, {
  props: { rows },
  target: document.body.appendChild(table),
})
```

**Version note (5.x):** text locators are exact by default, and `toHaveTextContent` checks strict equality. Use `toMatchTextContent` for partial or RegExp matching.

## Props and Rerendering

`rerender` updates props and waits for Svelte to apply them:

```ts
const { rerender } = await render(NumberDisplay, { number: 1 })

await rerender({ number: 2 })

await expect.element(page.getByText('2')).toBeVisible()
```

(`page` comes from `vitest/browser`.) Prefer testing through a parent that owns the state when the prop change comes from user interaction.

Table-drive prop variations with `test.for`:

```ts
test.for([
  { count: 0, label: 'No items' },
  { count: 1, label: '1 item' },
  { count: 5, label: '5 items' },
])('count $count renders "$label"', async ({ count, label }) => {
  const screen = await render(ItemCount, { count })
  await expect.element(screen.getByText(label)).toBeVisible()
})
```

## Callback Props and Events

Svelte 5 components expose events as callback props. Pass a `vi.fn()` and assert the call when the callback is the component's contract:

```ts
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import TodoInput from './TodoInput.svelte'

test('calls onadd with the trimmed text', async () => {
  const onadd = vi.fn()
  const screen = await render(TodoInput, { onadd })

  await screen.getByRole('textbox', { name: 'New todo' }).fill('  buy milk  ')
  await screen.getByRole('button', { name: 'Add' }).click()

  expect(onadd).toHaveBeenCalledWith('buy milk')
})
```

When the effect is visible (a list grows, a message appears), assert that instead.

## Testing Snippets

For simple snippets, render a small test-only wrapper component that passes dummy children:

```svelte
<!-- BasicSnippetHarness.svelte (test-only wrapper) -->
<script>
  import Subject from './basic-snippet.svelte'
</script>

<Subject>
  <span data-testid="child"></span>
</Subject>
```

```ts
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-svelte'
import SubjectTest from './BasicSnippetHarness.svelte'

test('renders children inside the heading', async () => {
  const screen = await render(SubjectTest)

  const child = screen.getByRole('heading').getByTestId('child')
  await expect.element(child).toBeInTheDocument()
})
```

To check snippet arguments, build the snippet with Svelte's `createRawSnippet`:

```ts
import { createRawSnippet } from 'svelte'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-svelte'
import Greeting from './Greeting.svelte'

test('passes the greeting to the message snippet', async () => {
  const screen = await render(Greeting, {
    name: 'Alice',
    message: createRawSnippet((greeting) => ({
      render: () => `<span data-testid="message">${greeting()}</span>`,
    })),
  })

  await expect.element(screen.getByTestId('message')).toHaveTextContent('Hello, Alice!')
})
```

## Async Updates

Svelte applies state changes asynchronously. `expect.element` retries, so there's no need to `await tick()` before each assertion:

```ts
test('shows an error for an invalid email', async () => {
  const screen = await render(SignupForm)

  await screen.getByLabelText('Email').fill('not-an-email')
  await screen.getByRole('button', { name: 'Sign up' }).click()

  await expect.element(screen.getByRole('alert')).toHaveTextContent('Enter a valid email')
})
```

For non-DOM conditions, `await expect.poll(...)` or `await vi.waitFor(...)`. Unawaited async assertions fail the test in 5.x.

## Mocking Modules

Browser Mode uses native ESM: `vi.spyOn` on an imported namespace throws. Use `vi.mock(path, { spy: true })` or a factory, at the top level of the file:

```ts
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import * as api from './api'
import Profile from './Profile.svelte'

vi.mock(import('./api'), { spy: true })

test('renders the loaded profile', async () => {
  vi.mocked(api.loadProfile).mockResolvedValue({ name: 'Ada' })

  const screen = await render(Profile, { id: '1' })

  await expect.element(screen.getByRole('heading', { name: 'Ada' })).toBeVisible()
})
```

- 5.0: automocked modules without a factory return `undefined` in the browser.
- 5.1: Vitest errors if a module was imported before `vi.mock` registered it.
- Prefer MSW for HTTP. See [network-requests.md](../mocking/network-requests.md).

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `const screen = render(C, props)` (4.x style) | 5.x returns a promise; queries hit nothing | `await render(C, props)` |
| `await tick()` sprinkled before assertions | Noise; still races async work | `await expect.element(...)` retries |
| Reaching into `component` for internal state | Tests implementation details | Assert on rendered output |
| Querying `container.querySelector('.btn')` | Brittle to markup changes | Role/label/text locators |
| Testing snippet output by inspecting compiled code | Couples to compiler output | Wrapper component or `createRawSnippet` |
| `vi.spyOn(apiNamespace, 'fn')` in Browser Mode | Throws: sealed ESM namespace | `vi.mock(path, { spy: true })` |
| `toHaveTextContent(/regex/)` | RegExp no longer accepted in 5.x | `toMatchTextContent(/regex/)` |

## Related References

- [component-testing.md](../testing-patterns/component-testing.md) - component test patterns
- [browser-mode.md](../testing-patterns/browser-mode.md) - providers, locators, assertions
- [dom-environments.md](../testing-patterns/dom-environments.md) - jsdom/happy-dom setup
- [module-mocking.md](../mocking/module-mocking.md) - `vi.mock`, partial mocks
- [async-testing.md](../core/async-testing.md) - `expect.poll`, `vi.waitFor`
- [migration.md](../architecture/migration.md) - 4.x → 5.x changes
