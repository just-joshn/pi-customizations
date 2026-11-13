# Request identity

Every request the `claude-subscription` provider sends identifies as Claude Code `2.1.316`: its user agent, `x-app: cli`, the Claude Code beta flags, a first system block carrying the billing fingerprint, and Claude session and prompt headers. A user can override headers through `models.json`.

## Sub-features

- `identity-headers` sends `user-agent: claude-cli/2.1.316 (external, sdk-cli)`, `x-app: cli`, and `anthropic-beta` including `claude-code-20250219` and `oauth-2025-04-20`, with no `x-api-key`.
- `identity-billing` makes the first system text `x-anthropic-billing-header: cc_version=2.1.316.<3 hex>; cc_entrypoint=sdk-cli;…`. For `Reply LOCAL_OK.` the core equals the captured `cc_version=2.1.316.959`.
- `identity-session` sets `x-claude-code-session-id` to Pi's RPC `sessionId` on every request, sets `x-claude-code-request-class: main`, and gives each prompt a fresh `x-claude-code-prompt-id`.
- `identity-override` uses `providers.claude-subscription.headers["user-agent"]` from `models.json` in place of the default.

## How to get to it (user POV)

- Select any `claude-subscription/*` model and send a prompt (interactive, `-p`, JSON, or RPC).
- Add `{"providers":{"claude-subscription":{"headers":{…}}}}` to `<agent dir>/models.json`.

## Driving it with control-claude-oauth

Preconditions:

- `doctor` passes. The drive writes a fixture oauth credential and a `models.json` pointing at the local peer.

- **Run.** `./.pi/skills/verify-pi-anthropic-oauth/bin/control-claude-oauth drive request-identity`. For two scenarios (`default` and `models-json-override`), the drive starts `pi --mode rpc`, sends `Reply LOCAL_OK.` and a second prompt, and reads `get_state`.
- **Default identity.** Both requests carry the captured user agent, `x-app: cli`, the bearer for the stored token, the RPC `sessionId`, and request class `main`. The first request's billing core equals the fixture's.
- **Override.** Both requests carry `claude-cli/9.9.9 (verify)`, and every other assertion still holds.
- **Proof.** `artifacts/verify-pi-anthropic-oauth/request-identity/requests.json` holds the sessionId and the per-request headers, billing text, system preamble prefix, tools, and message roles.

## Gotchas

- The billing fingerprint depends on the first non-meta user text. Changing the prompt changes the 3-hex suffix, so compare only the `Reply LOCAL_OK.` request to the fixture.
- The trailing `cch=…` attribution varies per request. Compare the core up to `cc_entrypoint=sdk-cli;`.
- Header overrides do not change the pinned version inside the billing block.
- When Claude Code is re-pinned, update the fixture path in `bin/control-claude-oauth` and the regex there.
- Compaction and virtual-model routing also carry this identity. `bun run prove:paths` in the extension covers them. This drive does not.
