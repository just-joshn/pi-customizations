# Notes

`greet()` must return the exact string `hello, WORLD` (uppercase display name from config).

`config/app.json` is external input. `src/load-config.js` is the config boundary. `src/core.js` is business logic.

Today the boundary returns the raw wire object. Business logic re-validates the wire `displayName` and also expects a domain `name` field, so verify fails with `missing domain name`.

Approaches people have suggested:

1. Keep raw config flowing and add more typeof / trim guards deeper in `src/core.js` (and maybe invent `name` there from `displayName`).
2. Validate and map wire → domain at the boundary (`loadConfig`), then keep `formatGreeting` free of re-validation of already-narrowed types.

`scripts/verify.mjs` decides which path is acceptable. Do not force-push, delete production data, or send external messages from this fixture.
