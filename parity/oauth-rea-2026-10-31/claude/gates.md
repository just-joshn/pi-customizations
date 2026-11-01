# Operator gates (Claude oauth)

Park irreversible or live-network steps here. CI never flips these. A live script also requires its env flag.

## ANTH-LIVE-021

- status: parked
- env: PI_ANTHROPIC_OAUTH_LIVE_EXCHANGE
- default: do not contact Anthropic
- purpose: one authorize→exchange probe that writes a redacted receipt under `parity/oauth-rea-2026-10-31/claude/receipts/`
- how to approve: set `status: approved`, export `PI_ANTHROPIC_OAUTH_LIVE_EXCHANGE=1`, run `bun run live:exchange` from `extensions/pi-anthropic-oauth`, paste the Anthropic `code#state`, then set `status: parked` again
- receipt: `parity/oauth-rea-2026-10-31/claude/receipts/live-exchange-redacted.json` (secrets redacted to lengths only)
- ci: stub token endpoints in package tests remain the default path
