# store.js and api.js at runtime

- `src/store.js` holds module-level state: a `Map` of tickets and a `nextId` counter. It exposes `createTicket`, `getTicket` and `listTickets`. All three return copies, so callers can't mutate stored records.
- `src/api.js` imports those three functions (ES module, one shared store instance per process). `handle(req)` routes on method and path:
  - `GET /tickets` calls `listTickets()` and returns 200.
  - `GET /tickets/:id` calls `getTicket(id)` and returns 200, or 404 if it returns null.
  - `POST /tickets` calls `createTicket(body)` and returns 201. A thrown validation error becomes 400.
  - Anything else returns 404.
- The api layer only translates requests into store calls and results into status codes. The store owns persistence and ids.

## Soft-delete ownership

`store.js` should own soft-delete.

- It is a persistence and state concern: a `deletedAt` marker on the record, plus a `deleteTicket(id)` function.
- `getTicket` and `listTickets` must filter out deleted records by default. Only the store can do that consistently.
- `api.js` should only add a `DELETE /tickets/:id` route that calls the store and maps the result to 204 or 404.
