# File System

## Table of Contents

1. [Choosing an Approach](#choosing-an-approach)
2. [In-Memory fs with memfs](#in-memory-fs-with-memfs)
3. [Seeding and Inspecting the Volume](#seeding-and-inspecting-the-volume)
4. [Injecting Specific Errors](#injecting-specific-errors)
5. [Real Temp Directories](#real-temp-directories)
6. [Design for Testability](#design-for-testability)

## Choosing an Approach

Vitest has no built-in fs mocking API. Options:

| Approach | Use when | Trade-off |
| --- | --- | --- |
| **memfs** via `__mocks__` + `vi.mock('node:fs')` | Unit tests of code that reads/writes files; many tests; need isolation from disk | Only modules mocked with `vi.mock` are redirected; native addons and child processes still see the real disk |
| **Real temp directory** (`mkdtemp`) | Code shells out, uses globbing/watchers/streams, or relies on real permissions/symlinks | Touches disk; must clean up; slower |
| **Partial `vi.mock` factory** on `node:fs/promises` | Simulating one specific failure (EACCES, ENOSPC) | Only covers the functions you replace |
| **Inject an fs-like dependency** | You own the code and can pass `readFile` in | Requires a small design change |

The Vitest docs recommend memfs over hand-written `vi.mock('fs')` factories, which are hard to maintain.

## In-Memory fs with memfs

Create root-level `__mocks__` files that re-export memfs. They apply to `node:fs` and `node:fs/promises` once a test calls `vi.mock` for them:

```js
// __mocks__/fs.cjs
const { fs } = require('memfs')
module.exports = fs
```

```js
// __mocks__/fs/promises.cjs
const { fs } = require('memfs')
module.exports = fs.promises
```

```ts
// src/read-hello-world.ts
import { readFileSync } from 'node:fs'

export function readHelloWorld(path: string) {
  return readFileSync(path, 'utf-8')
}
```

```ts
// src/read-hello-world.test.ts
import { fs, vol } from 'memfs'
import { beforeEach, expect, test, vi } from 'vitest'
import { readHelloWorld } from './read-hello-world'

vi.mock('node:fs')
vi.mock('node:fs/promises')

beforeEach(() => {
  vol.reset() // the volume is shared across tests in the file
})

test('returns the file contents', () => {
  fs.writeFileSync('/hello-world.txt', 'hello world')
  expect(readHelloWorld('/hello-world.txt')).toBe('hello world')
})
```

Notes:

- Mock both `node:fs` and `node:fs/promises` if the code (or a library it calls) uses both.
- `vi.mock` calls must be top-level (5.x throws otherwise). To mock fs in every test file, put the two `vi.mock` calls in a `setupFiles` entry.
- `vol.reset()` in `beforeEach` is required. The in-memory volume persists across tests in the same file.
- Modules that import `fs` must be imported normally (`import`), not via `require` from a CommonJS dependency; Vitest only intercepts `import`.

## Seeding and Inspecting the Volume

Build a directory tree in one call and assert on the resulting files:

```ts
import { vol } from 'memfs'
import { beforeEach, expect, test, vi } from 'vitest'
import { loadConfig, writeLockfile } from './config'

vi.mock('node:fs')
vi.mock('node:fs/promises')

beforeEach(() => {
  vol.reset()
})

test('reads config relative to the project root', async () => {
  vol.fromJSON(
    {
      './app.json': '{"port":8080}',
      './nested/extra.json': '{}',
    },
    '/project', // base directory for relative keys
  )

  await expect(loadConfig('/project/app.json')).resolves.toEqual({ port: 8080 })
})

test('returns defaults when the file is missing', async () => {
  await expect(loadConfig('/project/app.json')).resolves.toEqual({ defaults: true })
})

test('writes the lockfile', async () => {
  vol.mkdirSync('/project', { recursive: true })
  await writeLockfile('/project', { version: 1 })
  expect(vol.toJSON()).toEqual({
    '/project/app.lock': '{"version":1}',
  })
})
```

Missing paths throw real `ENOENT` errors from memfs, so "file not found" branches need no extra mocking.

## Injecting Specific Errors

For a failure memfs can't easily produce (permission denied, disk full), replace one function with a partial mock and keep the rest real:

```ts
import { readFile } from 'node:fs/promises'
import { expect, test, vi } from 'vitest'
import { loadConfig } from './config'

vi.mock(import('node:fs/promises'), async (importOriginal) => ({
  ...(await importOriginal()),
  readFile: vi.fn(),
}))

test('surfaces permission errors', async () => {
  const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  vi.mocked(readFile).mockRejectedValueOnce(error)

  await expect(loadConfig('/etc/app.json')).rejects.toThrow('permission denied')
})
```

A factory takes precedence over a `__mocks__` file for that module.

## Real Temp Directories

When the code depends on real fs behavior (child processes, watchers, symlinks, globbing libraries with their own fs bindings), use a fresh temp directory per test with a fixture that cleans up:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as baseTest, expect } from 'vitest'
import { loadConfig } from './config'

const test = baseTest.extend('tmpDir', async ({}, { onCleanup }) => {
  const dir = await mkdtemp(join(tmpdir(), 'myapp-'))
  onCleanup(() => rm(dir, { recursive: true, force: true }))
  return dir
})

test('reads a real file', async ({ tmpDir }) => {
  const file = join(tmpDir, 'app.json')
  await writeFile(file, '{"port":8080}')

  await expect(loadConfig(file)).resolves.toEqual({ port: 8080 })
})
```

- `mkdtemp` gives each test (and each parallel worker) a unique directory, so tests don't collide.
- Never write into the repo or a fixed path like `/tmp/out.json`; parallel files race on it.
- Don't mix this with `vi.mock('node:fs')` in the same file; the helper's `mkdtemp` would hit memfs.

## Design for Testability

If you own the code, the simplest test often needs no fs mocking at all:

```ts
export async function loadConfig(
  path: string,
  read: (p: string) => Promise<string> = p => readFile(p, 'utf8'),
) {
  return JSON.parse(await read(path))
}
```

```ts
test('parses the config', async () => {
  const read = vi.fn(async () => '{"port":8080}')
  await expect(loadConfig('/app.json', read)).resolves.toEqual({ port: 8080 })
  expect(read).toHaveBeenCalledWith('/app.json')
})
```

Keep parsing and validation in pure functions that take strings; test them without any fs.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Hand-written `vi.mock('fs', () => ({ readFileSync: ... }))` for many functions | Large, drifts from the real API | memfs via `__mocks__` |
| Mocking `node:fs` but not `node:fs/promises` | Some calls silently hit the real disk | Mock both |
| No `vol.reset()` between tests | Files from one test leak into the next | `beforeEach(() => vol.reset())` |
| Writing to fixed paths in the repo or `/tmp` | Parallel test files collide; leftovers | `mkdtemp` per test + cleanup |
| Forgetting temp-dir cleanup | Disk fills up in CI | `onCleanup(() => rm(dir, { recursive: true, force: true }))` |
| Expecting memfs to affect child processes or native addons | They use the real fs | Real temp dir |
| Asserting exact `readFile` call counts | Couples to implementation | Assert returned data or resulting files |

## Related References

- **`vi.mock`, `__mocks__`, partial mocks**: See [module-mocking.md](module-mocking.md)
- **Fixtures with cleanup**: See [fixtures-hooks.md](../core/fixtures-hooks.md)
- **Real dependencies vs mocks**: See [when-to-mock.md](../architecture/when-to-mock.md)
- **Integration tests against real resources**: See [integration-testing.md](../testing-patterns/integration-testing.md)
