# Agent notes

Do not import `src/db.js` from feature modules. Use `src/store.js` instead.

Enforced by `npm run lint`.

## Rule table

| Rule | Enforced by |
| --- | --- |
| Feature modules never import `src/db.js`; use `src/store.js` | `npm run lint` (scripts/check-store-boundary.js), run by `npm test` and CI |
