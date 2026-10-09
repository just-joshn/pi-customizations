# run-smoke-tests results

## Command

```bash
npm run smoketest
```

Workspace: `parity/evidence/team-kit/fixture-apps/run-smoke-tests`

## Initial failure

- Exit code: 1
- Error: `smoketest failed: ready must be true`
- Cause: `app.js` exported `ready = false`

## Fix

- Minimal change: set `export const ready = true;` in `app.js`

## Rerun

```
SMOKE_OK
```

Exit code: 0

## Flake risk

None — assertion is a static source regex check, not timing-dependent.
