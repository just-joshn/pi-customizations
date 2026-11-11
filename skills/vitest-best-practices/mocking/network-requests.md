# Mocking Network Requests

## Table of Contents

1. [Why MSW](#why-msw)
2. [Server Setup](#server-setup)
3. [Unhandled Requests](#unhandled-requests)
4. [Per-Test Overrides](#per-test-overrides)
5. [Error Responses and Network Failures](#error-responses-and-network-failures)
6. [Asserting What Was Sent](#asserting-what-was-sent)
7. [GraphQL and WebSocket](#graphql-and-websocket)
8. [When a Spy on fetch Is Enough](#when-a-spy-on-fetch-is-enough)

## Why MSW

The Vitest docs recommend [Mock Service Worker](https://mswjs.io/) for HTTP, GraphQL, and WebSocket mocking. It intercepts requests at the network layer (via `@mswjs/interceptors` in Node), so application code keeps calling real `fetch`/HTTP clients and your tests exercise URL building, headers, body serialization, and response parsing.

Prefer it over `vi.mock`-ing your HTTP client or stubbing `fetch`. Those mocks bypass the code that most often breaks and drift from the real API shape.

## Server Setup

Put one server in a setup file so every test file gets it:

```ts
// tests/msw.ts
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll } from 'vitest'

export const handlers = [
  http.get('https://api.example.com/users/:id', ({ params }) => {
    return HttpResponse.json({ id: params.id, name: 'Ada' })
  }),
]

export const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' })) // MSW 3.x; 2.x uses onUnhandledRequest, see below
afterEach(() => server.resetHandlers()) // drop per-test overrides
afterAll(() => server.close())
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./tests/msw.ts'],
  },
})
```

- `server.resetHandlers()` in `afterEach` is required for isolation; without it, a `server.use()` override leaks into later tests.
- Default handlers should describe the happy path. Tests override only what they need.

## Unhandled Requests

Configure the server to **error** on requests with no matching handler, so a missing handler or a wrong URL fails loudly instead of hitting the real network.

The option name depends on the MSW major version. Check `msw` in `package.json`:

| MSW | Option |
| --- | --- |
| 2.x (what the Vitest 5.1 docs show) | `server.listen({ onUnhandledRequest: 'error' })` |
| 3.x | `server.listen({ onUnhandledFrame: 'error' })` |

**Version note:** with MSW 3.x, `onUnhandledRequest` is silently ignored; unhandled requests only log a warning and go to the real network (checked against msw 3.0.5). Use `onUnhandledFrame` there.

With the error strategy, the unhandled request makes `fetch` reject inside the code under test. If that code swallows errors, the test can still pass. Assert on the visible result, not just "did not throw".

## Per-Test Overrides

`server.use()` prepends handlers for the current test. `resetHandlers()` removes them afterwards.

```ts
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'
import { server } from '../tests/msw'
import { getUser } from './api'

test('returns the user', async () => {
  await expect(getUser('1')).resolves.toEqual({ id: '1', name: 'Ada' })
})

test('handles an empty profile', async () => {
  server.use(
    http.get('https://api.example.com/users/:id', () => {
      return HttpResponse.json({ id: '1', name: '' })
    }),
  )

  await expect(getUser('1')).resolves.toMatchObject({ name: '' })
})
```

A handler with `{ once: true }` applies to one matching request, then falls back to the next handler. Use it for retry logic:

```ts
test('retries once after a 503', async () => {
  server.use(
    http.get(
      'https://api.example.com/users/:id',
      () => new HttpResponse(null, { status: 503 }),
      { once: true },
    ),
  )

  await expect(getUserWithRetry('1')).resolves.toMatchObject({ name: 'Ada' })
})
```

## Error Responses and Network Failures

Test both HTTP errors (the server answered) and network errors (no response):

```ts
test('surfaces a 500 as an error', async () => {
  server.use(
    http.get('https://api.example.com/users/:id', () => {
      return HttpResponse.json({ message: 'boom' }, { status: 500 })
    }),
  )

  await expect(getUser('1')).rejects.toThrow('HTTP 500')
})

test('surfaces a network failure', async () => {
  server.use(
    http.get('https://api.example.com/users/:id', () => HttpResponse.error()),
  )

  // fetch rejects with a TypeError on network errors
  await expect(getUser('1')).rejects.toThrow(TypeError)
})
```

For timeouts, combine a handler that never resolves (or delays) with fake timers or an `AbortSignal` in the code under test. Don't wait real seconds.

Always `await` `.resolves`/`.rejects`. Unawaited async assertions fail the test in 5.x.

## Asserting What Was Sent

Assert on the outcome first. When the request itself is the contract (a POST body, auth header), capture it in the handler with a `vi.fn()`:

```ts
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

test('creates the user with the given name', async () => {
  const received = vi.fn()

  server.use(
    http.post('https://api.example.com/users', async ({ request }) => {
      received({
        auth: request.headers.get('authorization'),
        body: await request.json(),
      })
      return HttpResponse.json({ id: '2' }, { status: 201 })
    }),
  )

  await expect(createUser({ name: 'Bo' })).resolves.toEqual({ id: '2' })
  expect(received).toHaveBeenCalledExactlyOnceWith({
    auth: expect.stringMatching(/^Bearer /),
    body: { name: 'Bo' },
  })
})
```

Read the body inside the handler. The `Request` is consumed once.

## GraphQL and WebSocket

Both are in the Vitest docs with the same `setupServer`/`resetHandlers` lifecycle. In MSW 3.x, `graphql` moved to `msw/graphql`, needs the `graphql` package installed, and operations are scoped to an endpoint with `graphql.link(url)`. In 2.x (what the Vitest 5.1 docs show) it is exported from `msw` and you call `graphql.query(...)` directly.

```ts
import { HttpResponse, ws } from 'msw'
import { graphql } from 'msw/graphql'
import { setupServer } from 'msw/node'

const api = graphql.link('https://api.example.com/graphql')

const graphqlHandlers = [
  api.query('ListPosts', () => {
    return HttpResponse.json({ data: { posts: [{ id: 1, title: 'Hello' }] } })
  }),
]

const chat = ws.link('wss://chat.example.com')

const wsHandlers = [
  chat.addEventListener('connection', ({ client }) => {
    client.addEventListener('message', (event) => {
      client.send(`Server received: ${event.data}`)
    })
  }),
]

export const server = setupServer(...graphqlHandlers, ...wsHandlers)
```

## When a Spy on fetch Is Enough

For a single call where you only care that it happened, a scoped spy is acceptable and restores itself:

```ts
test('posts analytics on login', async () => {
  using fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{"ok":true}'))

  await login('alice', 'secret')

  expect(fetchSpy).toHaveBeenCalledWith(
    'https://analytics.example.com/events',
    expect.objectContaining({ method: 'POST' }),
  )
})
```

Switch to MSW once you need several endpoints, realistic responses, or error cases.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `vi.mock('axios')` / mocking your HTTP client | Skips request building and response parsing; drifts from the API | MSW handlers at the network layer |
| No `server.resetHandlers()` in `afterEach` | Overrides leak into later tests | Reset after each test |
| Default unhandled-request strategy | Missing handlers hit the real network or only warn | Error strategy (`onUnhandledRequest` in 2.x, `onUnhandledFrame` in 3.x) |
| `onUnhandledRequest` with MSW 3.x | Silently ignored | `onUnhandledFrame: 'error'` |
| Only testing the happy path | Error handling untested | `server.use()` with 4xx/5xx and `HttpResponse.error()` |
| Asserting only that a handler ran | Passes even if the UI or result is wrong | Assert the visible outcome; capture requests only when they are the contract |
| Real delays for timeout tests | Slow and flaky | Fake timers or abort signals |
| Calling real third-party APIs in unit tests | Flaky, rate-limited, slow | Mock at the boundary; cover real calls in a few integration/E2E tests |

## Related References

- **Shared setup files and hooks**: See [fixtures-hooks.md](../core/fixtures-hooks.md)
- **Asserting async results**: See [async-testing.md](../core/async-testing.md)
- **Timeouts with fake timers**: See [timers-dates.md](timers-dates.md)
- **Spies and `using`**: See [mock-functions.md](mock-functions.md)
- **Mock at the boundary**: See [when-to-mock.md](../architecture/when-to-mock.md)
- **Real services in tests**: See [integration-testing.md](../testing-patterns/integration-testing.md)
