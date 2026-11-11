# Browser Mode

## Table of Contents

1. [When to Use Browser Mode](#when-to-use-browser-mode)
2. [Setup and Providers](#setup-and-providers)
3. [Headless, UI, and Running](#headless-ui-and-running)
4. [Locators (Strict by Default)](#locators-strict-by-default)
5. [Interactions: userEvent and Locator Methods](#interactions-userevent-and-locator-methods)
6. [Retrying Assertions with expect.element](#retrying-assertions-with-expectelement)
7. [Mocking Limitations](#mocking-limitations)
8. [Commands](#commands)
9. [ARIA Snapshots](#aria-snapshots)
10. [Visual Regression: toMatchScreenshot](#visual-regression-tomatchscreenshot)
11. [Trace View](#trace-view)
12. [Multiple Browsers and Setups](#multiple-browsers-and-setups)

## When to Use Browser Mode

Browser Mode runs test files in a real browser (through Playwright, WebdriverIO, or a preview provider) instead of a simulated DOM. Use it when results depend on real layout, CSS, events, focus, or browser APIs. It does not replace an E2E runner for full app flows; it tests components and modules in a browser.

Costs: slower startup (provider + browser launch) and a few mocking limits (below). Keep pure logic in `node` tests.

## Setup and Providers

```bash
npx vitest init browser                         # interactive setup
npm install -D vitest @vitest/browser-playwright  # or install manually
```

| Provider | Package | Notes |
| --- | --- | --- |
| `playwright` | `@vitest/browser-playwright` | Recommended. `chromium`, `firefox`, `webkit`. Parallel, headless, CDP |
| `webdriverio` | `@vitest/browser-webdriverio` | `chrome`, `firefox`, `edge`, `safari`. Community-maintained since 5.0 (vitest-community org) |
| `preview` | `@vitest/browser-preview` | Local preview only: no headless, simulated events via `@testing-library/user-event`. Not for CI |

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()], // your framework's Vite plugin
  test: {
    browser: {
      enabled: true,
      provider: playwright({ actionTimeout: 5_000 }),
      instances: [{ browser: 'chromium' }], // at least one instance is required
    },
  },
})
```

Keep Node tests and browser tests apart with [projects](../core/projects.md):

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.unit.{test,spec}.ts'], environment: 'node' } },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.{test,spec}.{ts,tsx}'],
          browser: { enabled: true, provider: playwright(), instances: [{ browser: 'chromium' }] },
        },
      },
    ],
  },
})
```

For types of `page`, `userEvent`, and the DOM matchers, reference `vitest/browser` once in a file covered by your `tsconfig.json`: `/// <reference types="vitest/browser" />`.

**Version notes (5.x):** the server port defaults to `23315` (set the top-level `api.port` to change it; `browser.api` is deprecated and ignored). Failure screenshots moved to `.vitest/attachments/failure-screenshots/`.

## Headless, UI, and Running

- `browser.headless` defaults to `true` in CI. Locally the browser is headed and shows the browser UI with the test iframe.
- `--browser.headless` runs headless locally; `--ui --browser.headless` shows results in Vitest UI.
- `--browser=chromium` picks a configured instance; the config must have a `browser` section.

```bash
npx vitest --project browser --browser.headless
```

## Locators (Strict by Default)

`page.getBy*` returns a lazy **locator**, not an element. Nothing is queried until you act or assert. Locators chain and filter, so you don't need `within()`.

```ts
import { page } from 'vitest/browser'

const deleteButton = page
  .getByRole('row')
  .filter({ hasText: 'Vitest' })
  .getByRole('button', { name: 'Delete' })
```

Priority: `getByRole` (with `name`) → `getByLabelText` → `getByPlaceholder` / `getByText` / `getByAltText` / `getByTitle` → `getByTestId` (attribute set by `browser.locators.testIdAttribute`, default `data-testid`). There is no `page.locator(css)`.

**Version note (5.0):** text matching is exact by default (`browser.locators.exact: true`): full, case-sensitive match. `getByText('Item')` no longer matches `Item 1`. Use a RegExp or `{ exact: false }` for partial matches:

```ts
page.getByText('Saved')                     // only "Saved"
page.getByText(/saved/i)                    // "Saved!", "Draft saved"
page.getByRole('button', { name: /save/i }) // regex for loose names
```

Escape hatches `.element()` (throws on 0 or >1 matches), `.query()` (null on 0, throws on >1), `.elements()`, `.all()`, and `await .findElement()` (retries) return raw elements. Use them only to pass elements to APIs that don't accept locators. When a locator finds nothing, the error prints the ARIA tree and HTML of the searched subtree (`browser.locators.errorFormat`: `'all'` default, `'aria'`, `'html'`).

## Interactions: userEvent and Locator Methods

Interactions go through CDP or WebDriver (real events), not simulated DOM events. Await every one.

```ts
import { expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'

test('signs in', async () => {
  renderLoginForm()

  await page.getByLabelText('Email').fill('ada@example.com')
  await page.getByLabelText('Password').fill('secret')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await userEvent.keyboard('{Escape}')

  await expect.element(page.getByRole('status')).toHaveTextContent('Signed in')
})
```

- Locator methods: `click`, `dblClick`, `tripleClick`, `fill`, `clear`, `hover`, `unhover`, `selectOptions`, `dropTo`, `wheel`, `screenshot`.
- `userEvent` adds `type`, `keyboard`, `tab`, `upload`, `dragAndDrop`, `copy`/`cut`/`paste`, and experimental `pointer` (5.1).
- Don't use `@testing-library/user-event` directly; it simulates events.
- The default `userEvent` instance keeps keyboard state across calls (unlike testing-library). Unreleased keys are reset before each test, but **pointer position and hover state are not**. If a test depends on a neutral hover state, reset it: `beforeEach(async () => { await userEvent.unhover(document.body) })`.
- `alert`/`confirm`/`prompt` block the page, so Vitest replaces them with default mocks. Mock them yourself if the return value matters.

## Retrying Assertions with expect.element

`expect.element(locator)` retries the DOM assertion until it passes or times out. Use it for every assertion on a locator. A plain `expect(locator)` checks once.

```ts
import { expect } from 'vitest'
import { page } from 'vitest/browser'

await expect.element(page.getByRole('alert')).toBeVisible()
await expect.element(page.getByRole('button', { name: 'Save' })).toBeDisabled()
await expect.element(page.getByText('Draft')).not.toBeInTheDocument()
await expect.element(page.getByRole('heading'), { timeout: 2_000 }).toHaveTextContent('Done')
```

**Version note (5.0):** `toHaveTextContent` is now an **exact** equality check and no longer accepts a RegExp. Partial and regex matches moved to `toMatchTextContent`:

```ts
await expect.element(banner).toHaveTextContent('Error!')   // exact
await expect.element(banner).toMatchTextContent(/error/i)  // partial / regex
```

Use `expect.poll` for non-DOM values (`await expect.poll(() => store.count).toBe(3)`). With fake timers, locator actions and `expect.element` advance the timers while waiting (5.1).

## Mocking Limitations

Browser Mode uses native ESM, so module namespaces are sealed:

```ts
import { vi } from 'vitest'
import * as api from './api'

// vi.spyOn(api, 'fetchUser') // ❌ throws in Browser Mode

vi.mock('./api', { spy: true }) // ✅ spies on every export, keeps real implementations
vi.mocked(api.fetchUser).mockResolvedValue({ id: '1', name: 'Ada' })
```

- **Version note (5.0):** `vi.mock(path)` without a factory now really automocks in the browser (exports return `undefined`). Use `{ spy: true }` to keep real behavior.
- **5.1:** mocks are served through import maps (`browser.importMapMocks`, experimental, on when supported). A module imported *before* `vi.mock` registered it now errors instead of silently using the original, and a mock factory can only provide exports the original module declares. Set `browser.importMapMocks: false` if this breaks you.
- For HTTP, prefer MSW in the browser ([network-requests.md](../mocking/network-requests.md)).

## Commands

Commands run on the Node server and return results to the browser.

```ts
import { expect, test } from 'vitest'
import { server } from 'vitest/browser'

const { readFile } = server.commands

test('loads a fixture', async () => {
  const csv = await readFile('./fixtures/users.csv') // relative to project root
  expect(csv).toContain('ada@example.com')
})
```

`writeFile` and `removeFile` also need `api.allowWrite`. `cdp()` is Playwright + Chromium only and needs `api.allowWrite` and `api.allowExec`. Custom commands are registered in `browser.commands` and called via `commands.myCommand()`; in 5.x a locator passed to a custom command arrives as `{ selector, locator }`, not a string.

## ARIA Snapshots

Assert the accessibility tree (roles, names, states) instead of HTML or pixels. Experimental. In Browser Mode, `expect.element` waits for the tree to stabilize before comparing.

```ts
await expect.element(page.getByRole('navigation')).toMatchAriaInlineSnapshot(`
  - navigation "Main":
    - link "Home":
      - /url: /
    - link "About":
      - /url: /about
`)
```

Use `toMatchAriaSnapshot()` to store it in the `.snap` file. Names and text can be hand-edited into `/regex/` patterns (for seeded data like prices); those patterns survive `--update`, and only mismatched literals are rewritten. Update workflow: [snapshots.md](snapshots.md).

## Visual Regression: toMatchScreenshot

```ts
import { expect, test } from 'vitest'
import { page } from 'vitest/browser'

test('primary button', async () => {
  renderButton({ variant: 'primary' })
  await expect.element(page.getByRole('button')).toMatchScreenshot('primary-button', {
    comparatorName: 'pixelmatch',
    comparatorOptions: { allowedMismatchedPixelRatio: 0.01 },
  })
})
```

- The first run writes a reference and **fails** so you review it. Commit references; update with `--update`.
- References are named `<name>-<browser>-<platform>.png`. Rendering differs across OS, GPU, fonts, and headed/headless, so generate and compare in one controlled environment (CI or a container).
- Keep visual tests in their own project (e.g. `*.vrt.test.ts`, headless, fixed `viewport`). A screenshot is not a substitute for behavior assertions.
- Screenshots of deleted tests are not cleaned up automatically.
- **Version note (5.0):** the reference directory is `browser.expect.toMatchScreenshot.screenshotDirectory` (default `__screenshots__`). `browser.screenshotDirectory` no longer affects references; if you had customized it, set the new option and move or regenerate references.

## Trace View

Records each action, `expect.element` assertion, and `page.mark()` with DOM snapshots.

- **5.1 default: `'failure-only'`.** Only failed tests keep a trace; the terminal error ends with the step timeline. Passing tests add no measurable cost.
- `browser.traceView: 'on'` (or `true`) records every test with a snapshot per step; `'off'` disables. `traceView.enabled` is deprecated in favor of `traceView.mode`.
- Open traces in the browser UI, Vitest UI, or the HTML reporter (`vitest run --reporter=html`, good for CI artifacts). 5.1 adds an Aria view of each snapshot.

```ts
await page.mark('submit order', async () => {
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect.element(page.getByRole('status')).toHaveTextContent('Order placed')
})
```

Playwright's own traces are a separate option (`browser.trace`).

## Multiple Browsers and Setups

`browser.instances` runs the same files in several configurations sharing one Vite server (better caching than separate projects).

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [
        { browser: 'chromium' },
        { browser: 'firefox' },
        { browser: 'webkit', viewport: { width: 390, height: 844 }, name: 'webkit-mobile' },
      ],
    },
  },
})
```

Instances are named after the browser (`<project name> (<browser>)` when the config has a `name`) unless `name` is set (required when the same browser appears twice). Filter with `--project=chromium`.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `expect(locator).toBeVisible()` without `.element` | Checks once; flaky on async rendering | `await expect.element(locator).toBeVisible()` |
| `getByText('Item')` expecting partial matches | Exact by default in 5.x | RegExp or `{ exact: false }` |
| `toHaveTextContent(/regex/)` | Not accepted in 5.x; exact equality only | `toMatchTextContent` |
| `@testing-library/user-event` in browser tests | Simulated events, not real ones | `userEvent` from `vitest/browser` |
| `vi.spyOn(moduleNamespace, 'fn')` | Throws: ESM namespace is sealed | `vi.mock(path, { spy: true })` |
| `preview` provider in CI | No headless, simulated events | `playwright` |
| Tests relying on hover state from a previous test | Pointer state persists within a file | `userEvent.unhover(document.body)` in `beforeEach` |
| Screenshot-only tests | Documents pixels, not behavior | Behavior assertions + separate VRT project |
| Generating reference screenshots on dev machines | Platform rendering noise | One controlled environment (CI/container) |
| `.element()` everywhere | No retry; throws on 0/many | Locators + `expect.element` |

## Related References

- **Component rendering (React, Vue, Svelte)**: [component-testing.md](component-testing.md)
- **Simulated DOM alternative**: [dom-environments.md](dom-environments.md)
- **Snapshot workflow**: [snapshots.md](snapshots.md)
- **Module and network mocking**: [module-mocking.md](../mocking/module-mocking.md), [network-requests.md](../mocking/network-requests.md)
- **Projects for Node + browser**: [projects.md](../core/projects.md)
- **Debugging failures**: [debugging.md](../debugging/debugging.md)
