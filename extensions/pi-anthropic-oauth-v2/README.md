# pi-anthropic-oauth-v2

This Pi extension lets you use a Claude subscription in Pi. It authenticates only with the subscription OAuth token from your claude.ai login. Pro, Max, Ultra, and Team (Standard or Premium) logins all work the same way.

It registers the provider `anthropic-oauth-v2`, built from Pi's own parts. Pi supplies them to extensions through `@earendil-works/pi-ai/providers/all`:

- **Login and refresh:** Pi's built-in Anthropic OAuth flow, with browser or copy-code login. Pi's credential store refreshes the token under its lock and saves it in `~/.pi/agent/auth.json` under `anthropic-oauth-v2`.
- **Requests:** Pi's Anthropic Messages implementation. It sends an OAuth token as a Bearer credential, with the Claude Code identity that Anthropic requires for subscription tokens.
- **Models:** Pi's built-in Anthropic catalog, listed under `anthropic-oauth-v2/`.

The extension adds only the OAuth-only check below. Pi's built-in `anthropic` provider is unchanged.

## OAuth only

The provider has no API-key handler, so Pi never reads `ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, workload identity federation, a stored `api_key` credential, or an API-key override for it. Pi still layers `models.json` settings (`apiKey`, `headers`, `modelOverrides`) onto every provider, so the provider checks the final request just before it is sent. It refuses the request unless the credential is an `sk-ant-oat` access token, no pre-built SDK client is passed in, and every added header is `anthropic-beta` or `anthropic-version` with no `sk-ant-` key in its value. That covers headers set through Pi's `models.json` `headers` setting. Pi itself adds no headers on this path. The provider also refuses every request while `ANTHROPIC_CUSTOM_HEADERS` is set, because the Anthropic SDK reads that variable on its own and Pi does not document it. `test/oauth-only.test.ts` and `scripts/prove.sh` check this, including against a local server that records what actually arrives.

## Replaces the old Claude login

This extension replaces `@justjoshn/pi-anthropic-oauth` (provider `claude-subscription`) and Pi's built-in `anthropic` login. Keep only one Claude login. If two Claude providers are logged in at once, they offer the same model ids, so Pi and pi-pstack reject bare model names like `sonnet` or `claude-opus-5-5` as ambiguous. Remove the others first:

```bash
pi remove npm:@justjoshn/pi-anthropic-oauth
pi auth logout claude-subscription
pi auth logout anthropic
```

`scripts/prove.sh` checks that bare model names reach `anthropic-oauth-v2` when it is the only Claude login.

## Use it

```bash
pi -e extensions/pi-anthropic-oauth-v2
```

Run `/login`, choose **Anthropic (Claude subscription, OAuth)**, and sign in with your claude.ai account. Then pick an `anthropic-oauth-v2/...` model with `/model`.

This needs Pi 1.5.2 or later.

## Check your usage

Run `/claude-usage` to see how much of your plan's limits you have used. Pi has no built-in usage check, so the extension adds this command. It reads your stored login through Pi, asks Anthropic's subscription usage endpoint (`GET https://api.anthropic.com/api/oauth/usage`), and shows one line per limit:

```text
Current session: 19% used, resets in 15m
Current week (all models): 78% used, resets in 1d 15h 55m
Current week (Fable): 0% used, resets in 1d 15h 55m
```

The rows, their order, and the model names come from Anthropic, so a new limit shows up without an extension update. The notice turns into a warning when Anthropic marks any limit above normal. With no login, or with a credential that is not a subscription OAuth token, the command sends nothing and asks you to run `/login`. In print mode (`pi -p "/claude-usage"`) the lines go to stderr.

The command is `/claude-usage`, not `/usage`, because `pi-x-subscription-oauth` already registers `/usage`. Pi renames clashing commands to `/usage:1` and `/usage:2`.

## Check it

```bash
bun run test            # OAuth-only rule through pi-ai's real auth and stream paths
scripts/prove.sh        # real pi: registration, OAuth-only refusals, leanness, /claude-usage without a login
scripts/prove.sh --live # also a real /claude-usage, a real request, a tool call, and a forced token refresh (needs /login first)
```
