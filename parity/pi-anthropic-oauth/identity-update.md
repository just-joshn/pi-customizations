# Identity update, Claude Code 2.1.296

This note records the clean-room identity check referenced by `extensions/pi-anthropic-oauth/docs/claude-oauth-parity.md`. No Claude binary or private source was inspected.

## What was reconfirmed

`python3 extensions/pi-anthropic-oauth/scripts/capture-claude.py` under `parity/pi-anthropic-oauth/fixtures/attempt-1/loopback.sb` exited 0. The selected fields matched `extensions/pi-anthropic-oauth/test/fixtures/claude-code-2.1.296.json`:

- user agent `claude-cli/2.1.296 (external, sdk-cli)`
- billing `x-anthropic-billing-header: cc_version=2.1.296.c4b; cc_entrypoint=sdk-cli;`
- preamble `You are a Claude agent, built on Anthropic's Claude Agent SDK.`
- two `ephemeral` / `1h` system cache markers

The earlier boundary capture at `fixtures/attempt-2/identity-boundary-captures.jsonl` agrees with the target rule for the listed text lengths and the Unicode prompt. That is finite agreement, not proof of Claude's private fingerprint function.

## What this does not establish

Empty, image-only, and image-plus-text fingerprints were not recaptured from Claude. Interactive CLI identity was not captured. Service acceptance of the billing block was not tested. Pi's OAuth preamble remains `You are Claude Code, Anthropic's official CLI for Claude.` The captured SDK preamble is not imposed on Pi.
