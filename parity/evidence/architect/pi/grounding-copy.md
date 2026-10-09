# Grounding (how, simple path: 3 files, 62 lines, traced directly, no subagents)

## Overview
ticket-desk is a 3-layer ESM app: cli.js -> api.js -> store.js. Each file's header comment states its ownership.

## Traced flows
- `cli.js list`: argv -> `api.list()` -> `store.listTickets()` -> copies of every Map value -> `{ok:true,tickets}` -> JSON on stdout.
- `cli.js create <title>`: `rest.join(' ')` -> `api.create({title})` -> `store.createTicket({title,status})`. The store validates the title and throws. It allocates the id with `nextId++`, stores `{id,title,status,createdAt}` and returns a copy. The api catches the throw and returns `{ok:false,error}`. Otherwise it returns `{ok:true,ticket}`.
- `api.get(id)` -> `store.getTicket(id)` -> copy or null -> `{ok:false,error:'not found'}`. **The CLI has no `get` command.** Only `api.get` reaches `getTicket`.

## Ownership / invariants
- store: persistence (module-level `Map`), id allocation, record shape. It returns defensive copies, so callers can't mutate state. Ids are strings. `_resetForTests` is the only reset.
- api: validation and DTO shaping. It never throws, and always returns `{ok, ...}`.
- cli: argv parsing and printing only. It has no logic and the usage string is hardcoded.
- Status is a free-form string defaulting to 'open'. It is not validated and has no enum.
- No update or delete exists today. No tests exist.

## Gotchas relevant to soft-delete
1. Every read path (`listTickets`, `getTicket`) exposes all records. Any new flag must be filtered in the store, or each reader will have to remember to do it.
2. `status` is user-settable via `create`, so encoding deletion as `status:'deleted'` would collide with caller input.
3. Ids are never reused (monotonic), so tombstones can't clash with new tickets.
4. API errors are strings ('not found'), and a deleted ticket must not give callers a new error shape.
5. The CLI exposes only list/create, so delete/restore need new commands and a usage update.
