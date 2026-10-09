# control-ui harness notes

- Workspace: `parity/evidence/team-kit/fixture-apps/control-ui`
- Server: `node serve.mjs` on `http://127.0.0.1:8765` (started for this run)
- Harness: temporary local Chrome CDP script (`/tmp/control-ui-cdp-harness.mjs`)
  - Binary: Google Chrome headless (`--headless=new`, remote debugging port 19222)
  - No Playwright (or other browser package) added as a project dependency
- Steps: open page → click `#go` (Go) → read `#out` → screenshot
- Result: `#out` text became `UI_PROBE_OK`
- Marker: UI_PROBE
- Screenshot: `ui-harness-after.png`
