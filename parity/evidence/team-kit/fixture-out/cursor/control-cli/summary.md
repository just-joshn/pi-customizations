# control-cli harness summary

- Target: `node .../fixture-apps/control-cli/toy-cli.mjs`
- Harness: temporary PTY probe under `/tmp` (tmux capture was empty for this readline CLI)
- Flow: wait for `READY` → send `ping` → observe `PONG`
- Result: verified (`READY`, echoed `ping`, `PONG` present in transcript)
- Artifacts: `transcript.txt`, `summary.md`, `done.txt` in this directory
