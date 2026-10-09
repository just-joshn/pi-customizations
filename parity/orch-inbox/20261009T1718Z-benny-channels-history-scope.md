# Operator card — add `channels:history` (Benny unblocked almost)

Wizard grants are in place. Bot can **post** to `#playwright-results` (`C085H0B5PN1`). Config/grant were retargeted to that channel (wizard channel was not visible to the bot).

A harmless root test message is already posted (`parity/research/benny-triage-valid-post-slack-001/test-report.json`).

## Blocker

`conversations.history` / `conversations.replies` return `missing_scope`. Triage cannot read the thread without that.

## Do this

1. https://api.slack.com/apps → your app → **OAuth & Permissions**
2. Add Bot Token Scope: **`channels:history`** (and **`groups:history`** if private)
3. **Reinstall to Workspace**
4. Copy the new `xoxb-…` into `~/.config/benny/.env` as `BENNY_SLACK_BOT_TOKEN` / `SLACK_BOT_TOKEN`  
   (or re-run stage via wizard; fastest: edit `.env` then `source ~/.config/benny/load-env.sh`)
5. Confirm bot still in `#playwright-results` (`/invite` if needed)
6. Reply **ready**

Agent will verify history works, then run paired Cursor CLI + Pi Benny captures.
