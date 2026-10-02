# pi-antigravity-oauth

This Pi package lets a Google Antigravity subscription answer in Pi. It signs in with Google OAuth and sends requests to the Cloud Code Assist API (`v1internal`), the service the Antigravity CLI calls. It registers the provider `google-antigravity`, which Pi removed from its built-in providers.

The provider reuses Pi's own parts where the wire allows. Pi's transcript helpers and cost accounting come from `@earendil-works/pi-ai`, the entry point Pi supplies to extensions. Pi's Google message and tool conversion, thinking-level mapping, and stop-reason mapping build each request too, but Pi does not supply those modules to extensions. `src/pi-ai/` therefore holds verbatim copies of them from pi-ai 1.0.0. `bun run vendor` regenerates the copies from the pinned devDependency, and `bun run check:vendor` fails when they drift. Pi stores the login in `auth.json` and refreshes it. The package adds the Cloud Code envelope, its streaming reader, and the login flow. Pi's `google-generative-ai` API cannot send the envelope, because it rejects a custom `fetch`.

## Use it

From this directory:

```bash
pi -e .
```

Then run `/login` and choose **Sign in with Google (Antigravity)**. The browser returns to `http://localhost:51121/oauth-callback`. If the browser runs on another machine, paste the redirect URL from its address bar into Pi instead. Pick a `google-antigravity` model with `/model`.

After login, Pi asks Cloud Code which models the account can use (`fetchAvailableModels`) and adds them to a small built-in list. `/antigravity` shows the signed-in email, the project, the subscription tier, and the quota left on each model.

To keep the package for later sessions, run `pi install` with the path to this directory, or publish the package and install that npm name.

## What Google sees

Login uses the OAuth client of the Antigravity desktop app. The same client shipped in Pi 0.70.6 before Pi removed the provider. It asks for the Cloud Platform, email, profile, `cclog`, and `experimentsandconfigs` scopes, with PKCE.

Model requests go to `https://daily-cloudcode-pa.googleapis.com`, the endpoint the Antigravity CLI 1.2.8 calls. On a 403 or 404 the request moves to `https://daily-cloudcode-pa.sandbox.googleapis.com` and then to `https://cloudcode-pa.googleapis.com`. Rate limits, server errors, and a stream that closes before its finish reason end the attempt with an error that Pi's own retry recognizes. The provider retries them itself only when Pi's `retry.provider.maxRetries` setting allows it, which is 0 by default. Each request sends bearer auth and the Antigravity CLI user agent, `antigravity/cli/1.1.23 (aidev_client; os_type=<os>; arch=<arch>; cl=974125021; auth_method=consumer)`, with the host's OS and CPU in Go's spelling (`darwin`, `arm64`, `amd64`). The body is the Cloud Code envelope with `requestType: "agent"` and `userAgent: "antigravity"`. The system instruction is Pi's own prompt. Pi 0.70.6 put an Antigravity preamble first, but on 2026-09-27 Claude Sonnet 4.6, Claude Opus 4.6 Thinking, Gemini 3.1 Pro Low, and Gemini 3.8 Flash all answered and called tools without it. Claude models that reason also send `anthropic-beta: interleaved-thinking-2025-05-14`.

## Verify it

Run `bun install` first. It installs the Pi packages the tests import, pinned to 1.0.0. Pi does not install development dependencies when it loads the package.

- `bun run test` runs the provider, login, model catalog, and `/antigravity` against local servers that stand in for Google.
- `bun run typecheck` runs `tsc` in strict mode.
- `bun run check:vendor` confirms that `src/pi-ai/` still matches the pinned pi-ai sources.
- `node --experimental-strip-types scripts/prove-pi.ts` loads the extension in `pi`. It checks that `pi --list-models` lists the provider's models. Then it sends one prompt. If you are logged in, the prompt gets a live answer. If not, the script confirms that Pi asks you to log in.
