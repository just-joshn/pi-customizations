# Agent notes

Do not import `src/db.js` from feature modules. Use `src/store.js` instead.

## Rule table

| Rule | Enforced by |
| --- | --- |
| Feature modules must not import `src/db.js`; use `src/store.js` (e.g. `getUser`) | `npm run lint:store-boundary` → `scripts/check-store-boundary.js` (only `src/store.js` may import db) |
