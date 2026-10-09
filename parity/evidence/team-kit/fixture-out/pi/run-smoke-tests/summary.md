# Smoke test summary
- Initial: `npm run smoketest` failed: "ready must be true".
- Root cause: `app.js` had `export const ready = false;`.
- Fix: set `ready = true` in app.js.
- Result: reran twice, SMOKE_OK both times.
- Flake risk: none (static source check, deterministic).
