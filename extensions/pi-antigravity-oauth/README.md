# pi-antigravity-oauth

This Pi package lets a Google Antigravity subscription answer in Pi. It signs in the way the Antigravity CLI (`agy`) signs in, and it sends the requests that `agy` sends to the Cloud Code Assist API (`v1internal`). It registers the provider `google-antigravity`, which Pi removed from its built-in providers.

The provider reuses Pi's own parts where the wire allows. Pi's transcript helpers and cost accounting come from `@earendil-works/pi-ai`, the entry point Pi supplies to extensions. Pi's Google message and tool conversion and stop-reason mapping build each request too, but Pi does not supply those modules to extensions. `src/pi-ai/` therefore holds verbatim copies of them from pi-ai 1.0.2. `bun run vendor` regenerates the copies from the pinned devDependency, and `bun run check:vendor` fails when they drift. Pi stores the login in `auth.json` and refreshes it. The package adds the Cloud Code envelope, its streaming reader, and the login flow. Pi's `google-generative-ai` API cannot send the envelope, because it rejects a custom `fetch`.

## Use it

From this directory:

```bash
pi -e .
```

Then run `/login` and choose **Sign in with Google (Antigravity)**. Pi opens Google's consent page. Google then sends the browser to `https://antigravity.google/oauth-callback`, which shows an authorization code. Paste that code into Pi. This is the same page and the same paste step that `agy` uses, so the browser can run on any machine.

Pick a model with `/model` and an effort with Pi's thinking level. `agy` lists one model id per effort, such as `claude-sonnet-5-5-low`, and asks for `--model claude-sonnet-5-5 --effort low`. Pi shows the same split. The model is `claude-sonnet-5-5`, and the thinking levels `low`, `medium`, and `high` choose the effort. A level the model lacks moves to the nearest one it has. Every Antigravity model thinks, so thinking `off` selects the lowest effort.

Before login, Pi lists the agent models from a snapshot in `src/catalog-snapshot.ts`. After login, Pi asks Cloud Code which models the account can use (`fetchAvailableModels`) and adds the ones `agy` offers as agent models. `/antigravity` shows the signed-in email, the project, the subscription tier, and the quota groups that `agy` reads from `retrieveUserQuotaSummary`.

To keep the package for later sessions, run `pi install` with the path to this directory, or publish the package and install that npm name.

## What Google sees

These values were read from `agy` 1.3.1 on 2026-10-07. The login values come from the authorization URL that `agy` prints. The request values come from `agy` traffic captured through its `CLOUD_CODE_URL` override.

Login uses the `agy` OAuth client and asks `https://accounts.google.com/o/oauth2/auth` for the Cloud Platform, email, profile, `cclog`, `experimentsandconfigs`, `aicode`, and `openid` scopes, with PKCE, offline access, and forced consent. The code exchange and refresh go to `https://oauth2.googleapis.com/token`. As in `golang.org/x/oauth2`, a token counts as expired 10 seconds before Google's expiry. The email comes from `https://www.googleapis.com/oauth2/v2/userinfo`. The project comes from `loadCodeAssist` with the body `{"metadata":{"ideType":"ANTIGRAVITY"}}`. Login fails when Cloud Code names no project.

Model requests go to `https://daily-cloudcode-pa.googleapis.com`, or to the `CLOUD_CODE_URL` environment variable when it is set, as in `agy`. Each request sends bearer auth and the `agy` user agent, `antigravity/cli/1.3.1 (aidev_client; os_type=<os>; arch=<arch>; cl=994719654; auth_method=consumer)`, with the host's OS and CPU in Go's spelling (`darwin`, `arm64`, `amd64`). The body is the Cloud Code envelope with `requestType: "agent"`, `userAgent: "antigravity"`, and a request id of the form `agent/<session>/<turn start>/<turn>/<step>`. Each request names the effort's Cloud Code model id and sends that model's output limit and thinking settings from `fetchAvailableModels`. Tools are declared as OpenAPI `parameters` with upper-case type names. A Gemini model's tool results go back in a `model` turn, and other models' results go back in a `user` turn. The system instruction is Pi's own prompt.

Rate limits, server errors, and a stream that closes before its finish reason end the attempt with an error that Pi's own retry recognizes. The provider retries them itself only when Pi's `retry.provider.maxRetries` setting allows it, which is 0 by default.

Three differences from `agy` remain. `agy` adds `labels` with its own conversation and trajectory state, which Pi does not have. `agy` sends a numeric `sessionId` that stays fixed for the installation, and Pi sends its own session id. Node's `fetch` adds `Accept`, `Accept-Language`, and `Sec-Fetch-Mode` headers that Go's HTTP client does not send.

## Verify it

Run `bun install` first. It installs the Pi packages the tests import, pinned to 1.0.2. Pi does not install development dependencies when it loads the package.

- `bun run test` runs the provider, login, model catalog, and `/antigravity` against local servers that stand in for Google.
- `bun run typecheck` runs `tsc` in strict mode.
- `bun run check:vendor` confirms that `src/pi-ai/` still matches the pinned pi-ai sources.
- `node --experimental-strip-types scripts/prove-pi.ts` loads the extension in `pi`. It checks that `pi --list-models` lists the provider's models. Then it sends one prompt. If you are logged in, the prompt gets a live answer. If not, the script confirms that Pi asks you to log in.
- `node scripts/snapshot-catalog.mjs <response.json>` rewrites `src/catalog-snapshot.ts` from a saved `fetchAvailableModels` response.
