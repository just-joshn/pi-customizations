# Notes

`formatNameLegacy` in `src/legacyFormat.js` uppercases a name. `greet.js` and `banner.js` both call it today.

We already decided the replacement internal API is `formatName(name)` in `src/format.js`. No external users depend on the old export. Inventory callers, move them to `formatName`, and delete `src/legacyFormat.js` in the same change. Do not leave a permanent compatibility shim that keeps `formatNameLegacy` alive.

Target behavior after the migration:

- `greet()` returns `hello, WORLD`
- `banner()` returns `BANNER:TEAM`

`node scripts/verify.mjs` writes `MIGRATE-OK` when that holds and the legacy module is gone.

Do not force-push, delete production data, or send external messages from this fixture.
