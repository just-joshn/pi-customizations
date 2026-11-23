# Debug ingest

Debug mode starts a loopback NDJSON ingest server. The model receives the endpoint, required session header, and log path; a valid POST appends to `.pi/debug-<id>.log`, and `/logs` shows recent entries.

## Sub-features

- `debug-mode`: entering Debug starts the server and shows Debug in the status line.
- `debug-endpoint`: the guidance names an HTTP endpoint on `127.0.0.1:7242-7942`.
- `debug-ingest`: a POST with `X-Debug-Session-Id` returns 204 and writes one NDJSON line.
- `debug-logs`: `/logs` reports the log path and recent entries.
- `reproduction-flow`: `<reproduction_steps>` offers Proceed, Mark as fixed, and Follow-up.

## How to get to it (user POV)

Use `/debug` or `--mode=debug`; ask the model for the endpoint, required header, and log path. POST an event with `curl`, then run `/logs`. The server binds loopback only and starts on entering Debug. Leave Debug before testing cleanup.

## Driving it with the Pi TUI and curl

This journey is manual because the deterministic fake model does not yet emit a Debug guidance request. Use a fresh isolated TUI and a real model:

```sh
mkdir -p "$EVIDENCE/tui/agent" "$EVIDENCE/tui/work"
cd "$EVIDENCE/tui/work"
PI_CODING_AGENT_DIR="$EVIDENCE/tui/agent" \
  pi -ne -e "$REPO/extensions/no-ceilings/pi-modes/src/index.ts" \
  -np -nc --no-themes
```

In the owned tmux pane:

1. Send `/debug`, then a short "Start debugging" prompt so the model receives the Debug guidance.
2. Ask the model to repeat the ingest endpoint, required header, and NDJSON log path. Capture the pane.
3. POST one event with the exact values:

   ```sh
   curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$ENDPOINT" \
     -H 'Content-Type: application/json' \
     -H "X-Debug-Session-Id: $SESSION_ID" \
     --data '{"timestamp":1700000000000,"message":"verification probe"}'
   ```

4. Require `204`, the `.pi/debug-<id>.log` file with `verification probe` and a trailing newline, and `/logs` showing the same entry. Copy the pane captures, endpoint, response code, and log tail into `$EVIDENCE/`.

## Gotchas

- `test/debug.test.ts` is harness evidence, not a real Pi run. Use a real TUI for this feature.
- The endpoint path contains a random UUID and the server is loopback only. Do not scan the port range or bind a second server.
- The required header is the derived debug session id, not the Pi conversation id. Use the guidance value.
- A POST without the header, with a path traversal session id, or to the wrong path is rejected. Do not weaken those assertions.
- Leaving Debug should stop the server. Verify the endpoint refuses connections or is gone after leaving; a live server after exit is a bug.
