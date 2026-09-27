Feature: claude-subscription provider
Invocation: pi -e extensions/claude-subscription
Then: /login and choose Claude subscription
Then: /model claude-subscription/<model id>

Inputs: Claude Pro/Max browser login, or a pasted redirect URL
Config dependencies: CLAUDE_CODE_VERSION overrides the default 2.1.280
Output: Pi assistant events from a Messages stream
Errors: missing login throws before the stream returns. HTTP errors become stream error events. Overflow text is unchanged.
Side effects: OAuth tokens stored by Pi in auth.json. One POST to https://api.anthropic.com/v1/messages per turn.

PROVEN preserve  bearer when only auth token is set                 C-02
PROVEN preserve  anthropic-version 2023-06-01                      C-01
PROVEN preserve  accept and content-type application/json          C-01
INTENTIONAL      user-agent claude-cli, not Anthropic/JS           Pi OAuth path
INTENTIONAL      omit x-stainless-*                                Provider CLI identity
OBSERVED         token URL https://platform.claude.com/v1/oauth/token  Pi 0.87.1 oauth/anthropic.js
UNKNOWN          live subscription acceptance                      not called
PROVEN live      first system block must be the billing header     live bisect 2026-09-27: without it HTTP 400 out-of-extra-usage
