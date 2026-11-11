```ts
onTestFinishd(() => {})
beforeEachOnce(() => {})
```

```ts
import { render } from 'vitest-browser-vue'

const screen = render({})
screen.getByText('x')
```

```ts
import { render } from '@testing-library/solid'
```

```ts
import { page } from 'vitest/browser'

await expect.element(page.getByRole('button')).toBeVisible()
```

```ts
import { expect, test } from 'vitest'

test('node', () => {
  expect(document.body).toHaveClass('x')
})
```

```ts
import { expectTypeOf } from 'vitest'
import { pick } from './pick'

// @ts-expect-error excused by the plant exception
expectTypeOf(pick).toBeFunction()
vi.notInTheException()
```
