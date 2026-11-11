```ts
import { bench, describe, expect, test as baseTest, vi } from 'vitest'

baseTest.skp('typo', () => {})
const t = baseTest.extend({ db: 1 })
t.scoped({ db: 2 })
describe.skip.sequential('x', () => {})
const fn = vi.fn()
fn.mock.lastCalls
fn.withImplementationOnce(() => 1)
vi.when(fn).calledWith(1).thenResolvesForever(1)
```

```ts [vitest.config.ts]
vi.notARealApi()
expect(1).toBeNonsense()
```
