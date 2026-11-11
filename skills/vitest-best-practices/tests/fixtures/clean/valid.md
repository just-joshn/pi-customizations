Valid examples that must produce no problems. Each one depends on types that only resolve correctly through
bun's symlinked install: browser matchers from `vitest/browser`, and Solid JSX next to React JSX.

```tsx
import { expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

test('renders', async () => {
  await render(<button type="button">Save</button>)
  await expect.element(page.getByRole('button', { name: 'Save' })).toBeVisible()
})
```

```tsx
import { render } from '@solidjs/testing-library'
import { expect, test } from 'vitest'

test('solid renders', () => {
  const { getByText } = render(() => <p>Hello</p>)
  expect(getByText('Hello').textContent).toBe('Hello')
})
```

```tsx
import { expect, test } from 'vitest'

test('react element', () => {
  const element = <p className="x">Hi</p>
  expect(element.props.className).toBe('x')
})
```
