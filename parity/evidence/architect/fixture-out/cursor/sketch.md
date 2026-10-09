# Soft-delete design sketch (synthesized)

Caller's usage first. Types and signatures derived from it. Bodies are `not implemented` / TODO only — no product fill-in.

**Base:** arena candidate 1 (tombstone-in-place).  
**Grafts:** CLI verb `delete <id>` (from candidates 2/3); sharper live vs tombstone typedefs (from candidate 3). Restore stays out of v1 public surface (additive later).

## Usage (caller's view)

Soft-delete marks a ticket deleted without removing it from the store Map. Default reads hide deleted tickets. Deletion is a separate field from workflow `status`.

### README-style

```
# Soft-delete

Tickets stay in the store with deletedAt set. list and get omit deleted
tickets (get of a deleted id looks like missing). delete is idempotent:
deleting twice is still ok.

CLI:
  node src/cli.js list
  node src/cli.js create <title...>
  node src/cli.js delete <id>

API (programmatic):
  import { list, create, get, softDelete } from './api.js'
```

### Call site 1 — CLI operator

```js
// argv: delete 3
import { softDelete } from './api.js';
console.log(JSON.stringify(softDelete(process.argv[3])));
// → { ok: true, ticket: { id: '3', title: '...', status: 'open',
//       createdAt: 1…, deletedAt: 1… } }
// already gone / unknown id → { ok: false, error: 'not found' }
```

### Call site 2 — API after delete

```js
import { create, softDelete, list, get } from './api.js';

const { ticket } = create({ title: 'Spill' });
softDelete(ticket.id);

list();              // { ok: true, tickets: [/* no ticket.id */] }
get(ticket.id);      // { ok: false, error: 'not found' }
softDelete(ticket.id); // { ok: true, ticket: { …, deletedAt: <first stamp> } }
```

### Call site 3 — store / tests (escape hatch, not public product API)

```js
import {
  softDeleteTicket,
  listTickets,
  getTicket,
  listTicketsIncludingDeleted,
} from './store.js';

softDeleteTicket('1');
listTickets();                 // live only
getTicket('1');                // null (deleted treated as absent)
listTicketsIncludingDeleted(); // includes tombstones; test / admin only
```

---

## Types

```ts
/** Workflow status only. Never used as a deletion flag. */
type TicketStatus = string; // unconstrained today; default 'open' on create

/**
 * Live ticket as seen on default list/get (deletedAt always null).
 * Invariant: id is string Map key; never reused after soft-delete.
 */
type LiveTicket = {
  id: string;
  title: string;
  status: TicketStatus;
  createdAt: number;
  deletedAt: null;
};

/**
 * Tombstone retained in the same Map after soft-delete.
 * Returned from softDelete / listTicketsIncludingDeleted only.
 */
type DeletedTicket = {
  id: string;
  title: string;
  status: TicketStatus;
  createdAt: number;
  deletedAt: number; // epoch ms; set once on first soft-delete
};

/** Map-held record (store internal). */
type Ticket = LiveTicket | DeletedTicket;

/** Shallow copy returned to callers — never the Map-held object. */
type TicketCopy = Ticket;

/** API envelope — unchanged shape; softDelete follows get's not-found style. */
type ApiOkTicket = { ok: true; ticket: TicketCopy };
type ApiOkTickets = { ok: true; tickets: LiveTicket[] };
type ApiErr = { ok: false; error: string };
type ApiResultTicket = ApiOkTicket | ApiErr;
```

Encoded in types / signatures (not prose alone):

- `deletedAt: null | number` — deletion is orthogonal to `status`.
- Default `listTickets` / `getTicket` return only live tickets (`deletedAt === null`).
- `listTicketsIncludingDeleted` is the only store read that surfaces tombstones.
- No `restoreTicket` / `undelete` in v1 signatures (additive later without changing defaults).

---

## Signatures (not implemented)

### `src/store.js`

```js
// In-memory ticket store. Ownership: persistence, ids, soft-delete + hide policy.

let nextId = 1;
/** @type {Map<string, Ticket>} */
const tickets = new Map();

/**
 * Create a live ticket. Always sets deletedAt: null.
 * @param {{ title: string, status?: string }} fields
 * @returns {LiveTicket}
 * @throws if title missing / non-string
 */
export function createTicket({ title, status = 'open' }) {
  throw new Error('not implemented');
  // TODO: validate title (existing rule)
  // TODO: id = String(nextId++); ticket = { id, title, status, createdAt: Date.now(), deletedAt: null }
  // TODO: tickets.set(id, ticket); return { ...ticket }
}

/**
 * Live tickets only (deletedAt === null), Map insertion order, shallow copies.
 * @returns {LiveTicket[]}
 */
export function listTickets() {
  throw new Error('not implemented');
  // TODO: [...tickets.values()].filter(t => t.deletedAt === null).map(t => ({ ...t }))
}

/**
 * Live ticket by id, or null if missing OR soft-deleted.
 * Callers cannot distinguish missing vs deleted via this API (intentional hide policy).
 * @param {string} id
 * @returns {LiveTicket | null}
 */
export function getTicket(id) {
  throw new Error('not implemented');
  // TODO: const t = tickets.get(id); if (!t || t.deletedAt !== null) return null; return { ...t }
}

/**
 * Soft-delete by id. Idempotent: already-deleted → success with existing deletedAt.
 * Does not free the id. Does not remove the Map entry.
 * @param {string} id
 * @returns {DeletedTicket | null} copy after delete, or null if id unknown
 */
export function softDeleteTicket(id) {
  throw new Error('not implemented');
  // TODO: const t = tickets.get(id); if (!t) return null
  // TODO: if (t.deletedAt === null) { t.deletedAt = Date.now() }  // keep first stamp on re-delete
  // TODO: return { ...t }
}

/**
 * All tickets including tombstones. Not used by api/cli default paths.
 * Exists so hide policy stays in listTickets/getTicket without a boolean option
 * that leaks "includeDeleted" into every caller.
 * @returns {TicketCopy[]}
 */
export function listTicketsIncludingDeleted() {
  throw new Error('not implemented');
  // TODO: [...tickets.values()].map(t => ({ ...t }))
}

export function _resetForTests() {
  throw new Error('not implemented');
  // TODO: nextId = 1; tickets.clear()
}
```

### `src/api.js`

```js
// Facade: envelopes only. Soft-delete policy lives in the store.

import {
  createTicket,
  listTickets,
  getTicket,
  softDeleteTicket,
} from './store.js';

export function list() {
  throw new Error('not implemented');
  // TODO: return { ok: true, tickets: listTickets() }  // live only, via store
}

export function create(body) {
  throw new Error('not implemented');
  // TODO: existing try/catch around createTicket; tickets arrive with deletedAt: null
}

export function get(id) {
  throw new Error('not implemented');
  // TODO: existing null → { ok: false, error: 'not found' }
  // deleted ids already null from store → same not-found wording
}

/**
 * Soft-delete. Thin envelope over store; no second copy of hide/idempotency rules.
 * @param {string} id
 * @returns {ApiResultTicket}
 */
export function softDelete(id) {
  throw new Error('not implemented');
  // TODO: const ticket = softDeleteTicket(id)
  // TODO: if (!ticket) return { ok: false, error: 'not found' }
  // TODO: return { ok: true, ticket }
}
```

### `src/cli.js`

```js
#!/usr/bin/env node
import { create, list, softDelete } from './api.js';

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'list') {
  throw new Error('not implemented');
  // TODO: console.log(JSON.stringify(list()))
} else if (cmd === 'create') {
  throw new Error('not implemented');
  // TODO: console.log(JSON.stringify(create({ title: rest.join(' ') })))
} else if (cmd === 'delete') {
  throw new Error('not implemented');
  // TODO: console.log(JSON.stringify(softDelete(rest[0])))
  // TODO: exit 0 even on {ok:false} (same as create)
} else {
  throw new Error('not implemented');
  // TODO: console.error('usage: cli.js list|create <title>|delete <id>'); process.exit(1)
}
```

---

## Module map

```
cli.js          argv → delete <id> → api.softDelete → JSON stdout
                  (no deletedAt logic; no list filter of its own)

api.js          softDelete(id) envelope; list/get unchanged call sites,
                  behavior change only via store

store.js        ★ owns:
                  - Ticket.deletedAt
                  - softDeleteTicket (idempotent Map mutation)
                  - default hide in listTickets / getTicket
                  - listTicketsIncludingDeleted (internal/test escape)
                  - id permanence (no delete from Map, no nextId reuse)

Map<string, Ticket>   single source of truth; tombstones remain entries
```

Data flow (soft-delete):

```
CLI rest[0] → api.softDelete(id) → store.softDeleteTicket(id)
                                         → Map get → set deletedAt if null
                                         → shallow copy
              → { ok, ticket | error } → JSON
```

Data flow (list/get after delete):

```
api.list/get → store.listTickets/getTicket → keep deletedAt === null → copies / null
```

## Deliberately out of scope (v1)

- Restore / undelete (add later as named store/API verbs, not `includeDeleted` flags)
- Overloading `status` (e.g. `'deleted'`)
- Separate deleted Map / physical remove
- CLI `get` wiring (pre-existing gap; unchanged)
- `includeDeleted` flag on api.list / api.get

---

## Problem

ticket-desk can create, list, and get tickets but has no delete path. Soft-delete must plug into the existing three-layer stack (store Map + ids, API `{ok,...}` envelopes, CLI argv → JSON) without inventing a second persistence model or overloading workflow `status`. Phase A constraints: string Map keys that must not be reused; store owns persistence; API shapes envelopes; get maps store `null` to `'not found'`; list never fails; CLI treats API errors as stdout JSON with exit 0.

## Shape

Extend the Map-held ticket with `deletedAt`. Soft-delete writes an epoch ms and leaves the entry in place. Hide policy lives in `listTickets` / `getTicket` so every facade inherits it. Public product surface grows by one verb (`softDelete` / CLI `delete`). Complexity hidden: filter rules, idempotent re-delete, id permanence, missing-vs-deleted collapse on default get.

## Synthesis decision

Arena ran three structurally distinct candidates:

1. **Tombstone-in-place** (`deletedAt` on single Map) — chosen base.
2. **Lifecycle status** (`status: 'deleted'` + transition table + list/get options) — rejected.
3. **Dual collection** (active Map + archive Map + restore/listDeleted) — rejected as v1 primary.

Cross-judge preferred candidate 1 (29 vs 21 vs 16 on the rubric). Parent agreement: same base.

**Grafted from losers:** CLI name `delete` (not `soft-delete`); `LiveTicket` / `DeletedTicket` typedefs; restore deferred as future named verbs (pattern from dual-collection) rather than shipping four archive APIs or `includeDeleted` flags.

**Rejected:** status-as-deleted / lifecycle state machine; dual Maps as primary model; `scope` / `includeDeleted` on list/get.

## Tradeoffs accepted

- We accept that default `get` cannot distinguish "never existed" from "soft-deleted" in exchange for a single hide policy.
- We accept Map growth from tombstones (no purge in v1) in exchange for id permanence and a one-Map mental model.
- We accept a store-only `listTicketsIncludingDeleted` escape hatch in exchange for keeping `includeDeleted` off the public API.
- We accept no restore in v1 in exchange for a smaller public surface.
- We accept mutating the Map-held object’s `deletedAt` (existing store mutates internal records; returns stay shallow copies) in exchange for not inventing an immutable-update path the codebase lacks today.

## Alternatives considered

- **Separate deleted Map / physical remove:** splits one source of truth; dual lookups; heavier for the same verb.
- **Overload `status: 'deleted'`:** collapses workflow and lifecycle; leaks deletion into every status reader; fights unconstrained `status` today.
- **API/CLI-owned filter with store returning all rows:** duplicates hide policy; shallow store.
- **`includeDeleted?: boolean` on default list/get:** options expose an internal stage to every caller.
- **Hard delete (`Map.delete`):** fails the soft-delete requirement.

## Open questions and risks

- Should soft-delete of an already-deleted id keep the original `deletedAt` (chosen) or refresh the stamp?
- Is `listTicketsIncludingDeleted` acceptable as a named store export for tests?
- Should CLI refuse a missing id with usage/exit 1, or keep create’s empty-input → API error JSON / exit 0 pattern?

## Next implementation step

Extend `createTicket` to set `deletedAt: null`, then implement `softDeleteTicket` plus hide filters in `listTickets`/`getTicket` before wiring thin `api.softDelete` and the CLI `delete` branch.
