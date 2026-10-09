# Operator card — Slack linked; this chat still needsAuth

## Done
- Customize → Connect Slack → Slack Allow → Cursor **Link Account**
- `cursor.com/slack-connected` confirmed
- Desktop Customize: Slack not in Needs Attention (only gmail left)
- On-disk: `pi-pstack-parity-again` MCP project has **27** `slack_*` tools

## Blocker for THIS chat
Agent session still reports `plugin-slack-slack` = `needsAuth` (home/temp project host). Interactive `mcp_auth` cannot run inside the agent.

## Next (one of)
**A (preferred).** Open a **new Agent chat** with folder `src/personal/pi-pstack-parity-again` and say **ready** — MCP should expose `slack_*` tools there.

**B.** Still required for Benny either way:
1. `~/.config/benny/configuration.yaml` (real test channel/thread)
2. `BENNY_SLACK_BOT_TOKEN` or `SLACK_BOT_TOKEN` in the shell env
3. Account-owner grant for one harmless test-thread reply

Make-bot remains paid (`55f42e27`).
