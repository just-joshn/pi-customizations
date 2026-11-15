# pi-anthropic-oauth-v2

Use your Claude subscription in Pi. The extension signs in with your claude.ai account and refuses to send any request that does not carry a subscription OAuth token, so an API key never reaches Anthropic through it. It is for people who want Pi to bill their Claude plan and never an API account.

It adds the provider `anthropic-oauth-v2`. Login, token refresh, requests, and the model list all come from Pi's built-in Anthropic provider. Pi's own `anthropic` provider is unchanged.

## Install

```sh
pi install npm:@justjoshn/pi-anthropic-oauth-v2
```

Built and tested against Pi 1.5.2.

## Sign in

1. Start Pi and run `/login`.
2. Choose **Anthropic (Claude subscription, OAuth)** and sign in with your claude.ai account.
3. Run `/model` and pick an `anthropic-oauth-v2/...` model.

## Commands

`/claude-usage` shows how much of your plan's limits you have used. It sends your subscription token to `https://api.anthropic.com/api/oauth/usage` and prints one line per limit:

```text
Current session: 19% used, resets in 15m
Current week (all models): 78% used, resets in 1d 15h 55m
```

Anthropic decides which limits exist, so a new limit appears without an extension update. The notice becomes a warning when Anthropic marks a limit above normal. Without a subscription login, the command sends nothing and tells you to run `/login`. In print mode (`pi -p "/claude-usage"`) the lines go to stderr.

## Notes

- **No API keys.** The provider has no API-key handler, so Pi does not read `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN` for it.
- **Request check.** Just before each request, the provider refuses it unless the credential is an `sk-ant-oat` token, no prebuilt SDK client is passed in, and every extra header is `anthropic-beta` or `anthropic-version` without an `sk-ant-` key in its value. This also covers `apiKey` and `headers` set for the provider in Pi's `models.json`.
- **`ANTHROPIC_CUSTOM_HEADERS`.** The provider refuses every request while this variable is set, because the Anthropic SDK reads it on its own.
- **One Claude login.** `anthropic` and `anthropic-oauth-v2` offer the same model ids. Pick models by their provider prefix.

## Replaces `@justjoshn/pi-anthropic-oauth`

```sh
pi install npm:@justjoshn/pi-anthropic-oauth-v2
pi remove npm:@justjoshn/pi-anthropic-oauth
```

Then run `/login` again. The old package stored its login under a different provider.

## Develop

```sh
bun run --filter @justjoshn/pi-anthropic-oauth-v2 test
```
