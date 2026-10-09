# store.js ↔ api.js at runtime

`api.js` is the HTTP-shaped entrypoint. Callers invoke `handle(req)`; it matches method/path, then calls into `store.js`:

- `GET /tickets` → `listTickets()`
- `GET /tickets/:id` → `getTicket(id)` (404 if missing)
- `POST /tickets` → `createTicket(body)` (400 on validation throw)

`store.js` holds the in-memory `Map`, allocates ids, and returns copies of ticket records. `api.js` only routes and maps store errors/misses to status codes; it does not own data lifetime.

## Soft-delete ownership

**`store.js` should own soft-delete.** Persistence, id allocation, and record shape already live there. Soft-delete is a persistence rule (mark deleted, hide from default reads). `api.js` would only expose a DELETE (or equivalent) route that delegates to the store.