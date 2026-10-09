# Operator card — Benny grants wizard (2026-10-09T17:01Z)

Last 2 behavioral requirements need your Slack test-channel grants. Agent cannot invent them.

## Run

```bash
cd ~/src/personal/pi-pstack-parity-again
bash parity/scripts/wizard-benny-valid-grants.sh
source ~/.config/benny/load-env.sh
```

Writes (0600): `~/.config/benny/configuration.yaml`, `.env` (token), `test-thread-grant.json`, `load-env.sh`.

## Then

Open Agent chat **on this repo** (so Slack MCP exposes `slack_*`), say **ready**.

Make-bot already paid. Goal remains dual-pane same-prompt parity.
