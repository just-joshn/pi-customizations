# Soft-delete sketch

## Usage sketch (written first)
```
cli.js delete 3        -> {"ok":true,"ticket":{"id":"3",...,"deletedAt":171...}}
cli.js restore 3       -> {"ok":true,"ticket":{"id":"3",...}}      // deletedAt absent
cli.js list            -> only live tickets
cli.js list --deleted  -> only deleted tickets   (--all: both)
api.get('3')           -> {ok:false,error:'not found'} when deleted
api.remove('3') twice  -> second call ok:true (idempotent)
api.remove('99')       -> {ok:false,error:'not found'}
```

## Candidates (structurally distinct)
A. **Tombstone field in store** (`deletedAt: number|null`). The store owns visibility and filters by default. Reads take a `visibility` option.
B. **Separate `deleted` Map** (move records between two maps). The invariant is structural. The live Map never holds deleted tickets, so no filter can be forgotten. But restore and "list all" need two-map merges, and createdAt ordering is lost. `getTicket` also needs a second lookup for the deleted view.
C. Status-based (`status:'deleted'`). Rejected: collides with the free-form status the caller sets in `create`, and every reader must filter.

## Synthesis decision
Choose A. Visibility is decided in exactly one place (the store), and the default is "live only". An agent copying `listTickets()` as written is therefore correct everywhere. B's structural guarantee is matched by A's single choke point. B is rejected because of its merge cost. Interface stays small: two new store functions, plus one optional parameter on two existing ones. C is rejected as above.

## Red-flag screen
- No caller-side filtering: the default hides deleted records.
- No new error shape: deleted reads as 'not found'.
- Idempotent delete/restore, which is safe to retry.
- Ids are never reused, so tombstones need no id handling.

## Sketch: src/store.js
```js
/** @typedef {{ id:string, title:string, status:string, createdAt:number, deletedAt?:number }} Ticket */
/** @typedef {'live'|'deleted'|'all'} Visibility */

// existing record gains optional deletedAt; createTicket unchanged.

/** @param {{visibility?: Visibility}} [opts] default 'live' */
export function listTickets(opts) { throw new Error('not implemented'); }
// pseudocode: filter Map values by opts.visibility via isVisible(t, v); return copies

/** @param {string} id @param {{visibility?: Visibility}} [opts] default 'live' */
export function getTicket(id, opts) { throw new Error('not implemented'); }
// pseudocode: t = map.get(id); return t && isVisible(t, vis) ? copy : null

/** Idempotent: re-deleting keeps the original deletedAt. @returns {Ticket|null} null if unknown id */
export function softDeleteTicket(id) { throw new Error('not implemented'); }
// pseudocode: t = map.get(id); if !t -> null; t.deletedAt ??= Date.now(); return copy
// (internal record replaced via map.set(id, {...t, deletedAt}) to honour the immutability rule)

/** Idempotent. @returns {Ticket|null} null if unknown id */
export function restoreTicket(id) { throw new Error('not implemented'); }
// pseudocode: drop deletedAt via destructuring into a new object; map.set; return copy

function isVisible(ticket, visibility) { throw new Error('not implemented'); }
```

## Sketch: src/api.js
```js
export function list(query /* {visibility?: Visibility} */) { throw new Error('not implemented'); }
// validate visibility against allowed set -> else {ok:false,error:'invalid visibility'}
export function get(id) { /* unchanged: store default hides deleted -> 'not found' */ }
export function remove(id) { throw new Error('not implemented'); }
// softDeleteTicket(id) ?? -> {ok:false,error:'not found'} : {ok:true,ticket}
export function restore(id) { throw new Error('not implemented'); }
// restoreTicket(id) ?? same shaping as remove
```
`get` stays on the live view. `restore` must therefore address deleted ids through the store directly.

## Sketch: src/cli.js
```js
// commands: list [--deleted|--all] | create <title> | delete <id> | restore <id>
// parse flag -> visibility ('live' default); print JSON(api result); usage string updated.
```

## Open questions / risks
- Hard purge is out of scope.
- Should `get` accept a visibility option for inspecting deleted tickets? Deferred (YAGNI).
- Tests: none exist. Implementation needs the store tests for idempotence, visibility, and restore round trip.
- Note: the arena phase (multi-model runners) was replaced by candidates designed inline, because the system is only 62 lines.
