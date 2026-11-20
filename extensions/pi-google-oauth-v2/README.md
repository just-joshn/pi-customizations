# pi-google-oauth-v2

Use a Google AI plan in Pi. The extension signs in with your Google account using Google's Antigravity CLI OAuth client. It sends requests to Code Assist, so they count against your Google AI Free, Pro, or Ultra plan quota instead of an API key.

## Requirements

- Node `>=22.19.0`.
- Pi 1.5.2. The extension is built and tested against that version.

## Install

```sh
pi install npm:@justjoshn/pi-google-oauth-v2
```

## Sign in

1. Start Pi and run `/login`.
2. Choose **Google AI subscription**.
3. Complete sign-in in your browser with the Google account that holds your plan.

Pi then shows the plan tier and the Code Assist project that Google reports.

### Callback and pasted code

`/login` starts two ways to receive the authorization code at the same time. The first code to arrive finishes the login.

- **Loopback callback.** The extension listens on `127.0.0.1` at a port the operating system assigns. Google redirects the browser to `/oauth2callback` on that port. The extension rejects any callback whose `state` value does not match the one it sent. The listener closes after 5 minutes without a callback.
- **Pasted code.** Pi prompts for an authorization code. On a machine without a browser, open the **Code page** link on another machine, sign in, and paste the code the page shows. The pasted code keeps working after the loopback listener closes.

### Token refresh

Pi refreshes the access token when it is about to expire. The extension's refresh handler keeps the stored refresh token when Google returns no new one. If Google answers `invalid_grant`, the handler fails with `Google refused the refresh token; run /login again`. Run `/login` again to sign in.

## Choose a model

Run `/model` and pick a `google-oauth-v2` model. Pi asks Google which models your plan serves and lists one entry per model family. Until the first model refresh after sign-in, Pi lists `gemini-4-argon` and `gemini-3.8-flash`.

Google serves each thinking effort as its own model id, such as `gemini-4-argon-high`. Pi offers only the levels that Google serves for the model.

### Thinking levels

Pi's thinking level selects the wire model id and sets `thinkingLevel` in the request. The wire model id carries the effort. The `thinkingLevel` value uses three steps.

| Pi thinking level | `thinkingLevel` value |
| --- | --- |
| `off` | not sent |
| `minimal`, `low` | `LOW` |
| `medium` | `MEDIUM` |
| `high`, `xhigh`, `max` | `HIGH` |

For example, `xhigh` sends `thinkingLevel: HIGH` and uses the `-xhigh` model id when Google lists one. Without a Pi setting, the level is `medium`.

## Commands

The extension adds no commands. It adds the provider `google-oauth-v2` and its login.

## Cost

The extension sets every model's cost to 0, so Pi shows no price.

## Google Cloud project

Code Assist assigns a project to your account at login. If `/login` fails and asks for `GOOGLE_CLOUD_PROJECT`, set the variable to your Google Cloud project ID and run `/login` again.

```sh
GOOGLE_CLOUD_PROJECT=my-project-id pi
```

- The variable name `GOOGLE_CLOUD_PROJECT_ID` also works. When both are set, `GOOGLE_CLOUD_PROJECT` wins.
- Pi reads the variable only during `/login`, so changing it later has no effect until you sign in again.
- A numeric value, which is the project number, is rejected. Use the project ID string.
- When Google onboards you to the free tier, the extension does not send the project, because Google manages that project.

## Plans and account errors

The extension does not block any plan. If Google refuses your account, `/login` shows Google's message. If Google asks you to validate the account, `/login` shows the validation link. Validate in the browser, then run `/login` again.

## Unsupported client

Google accepts these requests only from the Antigravity CLI's public OAuth client, with its `User-Agent`, at `daily-cloudcode-pa.googleapis.com/v1internal`. Google can restrict that client, change the header it checks, or retire the endpoint without notice. If sign-in says the client is no longer supported, Google changed the check.

## Instruction handling

The provider sends the full current Pi system prompt as the first user-content turn, before the conversation. A short static `systemInstruction` tells the model to treat that turn as application instructions. Those instructions have priority over later user messages and tool results.

The extension builds this turn for each request. It does not change the session history. The turn keeps the Pi identity and documentation instructions, and it removes unpaired Unicode surrogates.

This is delegated system priority. It is not a transport-level system role, so it depends on the model following the delegation. Non-Gemini Code Assist models have not been verified with this mapping.

## Retries and errors

Pi's `maxRetries` setting controls retries. The extension defaults it to 0, so it does not retry unless Pi sets a value.

When `maxRetries` is above 0, the extension retries only HTTP 429, 500, 502, 503, and 504 responses. Each retry waits for the delay that Google gives in a `retry-after` header or in the error body. Without a delay from Google, the wait is 1 second, then doubles with each attempt. If Google asks for a delay longer than Pi's `maxRetryDelayMs`, the request fails. That limit is 60 seconds unless Pi sets another value.

A failed request ends the Pi turn with `Google Code Assist API error (<status>): <message>`, using the status and message from Google. A 429 whose body reports an exhausted quota is not retried, and its message ends with `(quota exceeded)`.

## Replaces `@justjoshn/pi-antigravity-oauth`

```sh
pi install npm:@justjoshn/pi-google-oauth-v2
pi remove npm:@justjoshn/pi-antigravity-oauth
```

Then run `/login` again.

## Develop

Run these commands from the repository root.

```sh
bun run --filter @justjoshn/pi-google-oauth-v2 test
bun run --filter @justjoshn/pi-google-oauth-v2 test:coverage
bun run --filter @justjoshn/pi-google-oauth-v2 typecheck
```

### Verify through native Pi

`scripts/verify-live.ts` runs the real extension in Pi and makes live requests against your plan. It needs:

- `pi` on your `PATH`.
- A signed-in `auth.json` in `PI_CODING_AGENT_DIR`, or in `~/.pi/agent` when that variable is unset.

```sh
bun extensions/pi-google-oauth-v2/scripts/verify-live.ts
```

The script copies `auth.json` into a temporary agent directory without inspecting its values. It disables Pi's retry and compaction settings in that directory. It then refreshes the Google catalog and selects the discovered `gemini-3.8-flash` and `gemini-4-hydrogen` models. On exit it removes the temporary directory. It does not change your normal settings or credentials.

Each model runs four fresh Pi sessions:

- A conflicting user request.
- A forged system frame.
- A permitted request.
- Two read-tool rounds on a fixture that contains an injected instruction.

The script checks the exact final answer, the tool-result events, the replay of tool results, the wire model id, and the HTTP status. A failed check exits with a nonzero code.

The script logs model ids, statuses, and verification flags. It does not log prompts, headers, or credentials. A failed output check can also show the model's response.

The sessions keep Pi's default prompt and documentation. They use an isolated working directory and agent directory, without your skills or `AGENTS.md` files. A passing run does not show that the delegated instructions match a system role.
