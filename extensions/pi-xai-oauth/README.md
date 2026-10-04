# pi-xai-oauth

This Pi package lets a SuperGrok or X Premium subscription answer in Pi with every model that grok build offers, including `grok-4.7-build-fast`. It registers the provider `grok-build`, which calls Grok Build's backend at `https://cli-chat-proxy.grok.com/v1`. Pi's built-in `xai` provider is unchanged. It keeps calling `https://api.x.ai/v1`, which does not serve the fast model.

The provider reuses Pi's own parts. It takes them from Pi's built-in `xai` provider, which `@earendil-works/pi-ai/providers/all` supplies to extensions. Pi's SuperGrok and X Premium device-code login handles sign-in and token refresh. Pi's OpenAI Responses implementation builds and streams every request. The package adds three things: the request headers that Grok Build expects, a model list that follows Grok Build's own catalog, and four model ids that pin the fast model's reasoning effort.

## Use it

From this directory:

```bash
pi -e .
```

Then run `/login`, choose **Sign in with an account**, and choose **Grok Build**. Pi shows a code and a link to xAI's verification page. Approve the code there with the account that holds the subscription. This login is separate from the login for the built-in `xai` provider, because Pi stores one credential for each provider.

Pick a `grok-build` model with `/model`. To keep the package for later sessions, run `pi install` with the path to this directory.

## Pick a model and an effort

Grok Build serves four models. Reasoning effort is Pi's thinking level, so choose it with `/thinking` or with a suffix such as `--model grok-build/grok-4.7-build-fast:xhigh`. Pi offers only the levels that a model supports.

| Model | Pi id | Thinking levels |
|---|---|---|
| Grok 4.7 | `grok-build/grok-4.7` | low, medium, high, xhigh |
| Grok 4.7 Fast | `grok-build/grok-4.7-build-fast` | low, medium, high, xhigh |
| Grok 4.6 | `grok-build/grok-4.6` | low, medium, high, xhigh |
| Grok 4.5 | `grok-build/grok-4.5` | low, medium, high |

Four more ids pin the fast model's effort: `grok-4.7-low-fast`, `grok-4.7-medium-fast`, `grok-4.7-high-fast`, and `grok-4.7-xhigh-fast`. They are Pi virtual models. Each one sends `grok-4.7-build-fast` with the effort in its name, and its thinking level cannot change. A tool that selects a model by one bare id, such as pstack's default `grok-4.7-xhigh-fast`, finds them.

Interactive Pi asks Grok Build for its model list when it starts and when `/model` opens. Pi keeps the answer in `models-store.json`, so print and RPC sessions use it too. A model that Grok Build adds appears after that refresh. The four models in the table are always listed, including before the first refresh.

## What xAI sees

Login is Pi's xAI device-code flow. It uses the same OAuth client id as grok build, `b1a00492-073a-47ea-816f-4c329264a828`. Each request sends the access token as bearer auth, and these headers:

- `x-grok-client-version: 1.0.46`. Without it, Grok Build answers HTTP 426 and asks for Grok CLI 1.0.13 or later.
- `X-XAI-Token-Auth: xai-grok-cli` and `x-grok-model-override` with the model id. Grok build's README lists both as required.
- `x-grok-context-window` with the model's context window in Pi. Grok build sends it too. On 2026-10-02 a 267,668-token request succeeded with and without it.
- `x-grok-conv-id` with the Pi session id. It keeps a session on the same prompt cache. In a test on 2026-10-02, the second request of a session reused the cached prompt in 4 of 4 runs with the header and in 1 of 4 runs without it.

The body is Pi's standard Responses request. It has `store: false`, the reasoning effort, and a request for encrypted reasoning so that the next turn can replay it. Grok Build adds its own preamble to each prompt. A short prompt reports about 1,250 input tokens on Grok 4.7 and about 210 on Grok 4.5, and most of them are cached.

## Cost

Grok Build reports a metered cost with every response. On 2026-10-02 the metered cost was 0.34 times xAI's API list price for Grok 4.7, Grok 4.6, and Grok 4.5. The same factor applied to the higher rate above 200,000 input tokens. Grok 4.7 Fast cost twice as much as Grok 4.7. Pi shows that metered price. It is the list price from Pi's bundled `xai` catalog times 0.34, and times 2 more for a `-build-fast` model. A model without a list price shows $0.

When the subscription's balance runs out, every request fails with `grok-build API error (402): 402 "Grok Build usage balance exhausted"`. The model list still loads.

## Change behavior with models.json

Pi's `models.json` settings apply to this provider.

To use the 500,000-token context window that Grok Build offers, override the model in `~/.pi/agent/models.json`. Pi then compacts at the larger limit, and the package sends the larger window in `x-grok-context-window`.

```json
{
	"providers": {
		"grok-build": {
			"modelOverrides": {
				"grok-4.7-build-fast": { "contextWindow": 500000, "maxTokens": 500000 }
			}
		}
	}
}
```

If Grok Build raises its minimum client version, requests fail with HTTP 426 and the message names the new minimum. To send a newer version before this package updates, set the header for the provider. Headers in `models.json` take precedence over the headers that the package sends.

```json
{
	"providers": {
		"grok-build": {
			"headers": { "x-grok-client-version": "1.0.60" }
		}
	}
}
```

## Verify it

Run `bun install` first. It installs the Pi packages that the tests import, pinned to 1.0.1. Pi does not install development dependencies when it loads the package.

- `bun run typecheck` runs `tsc` in strict mode.
- `bun run test` runs the provider against local stand-ins for Grok Build. `catalog.test.ts` parses the model list and computes the metered prices from Pi's real `xai` catalog. `request.test.ts` checks the headers. `provider.test.ts` checks the login, the models, and the alias routes. `live-catalog.test.ts` runs Pi's model refresh against a stubbed `/v1/models`. `stream.test.ts` streams one request through Pi's `Models` to a local Responses server and checks the headers and the body that arrive. `registration.test.ts` runs Pi's public `discoverAndLoadExtensions` on a temporary copy of the package.
- `bun run test:coverage` runs the same tests and enforces the coverage thresholds.
- `node --experimental-strip-types scripts/prove-pi.ts` loads the extension in the real `pi` binary. It checks that `pi --list-models` lists all eight ids, then sends one prompt to `grok-build/grok-4.7-xhigh-fast` with a fixture token and fails if Pi cannot resolve that id.

From the repository root, `make verify-oauth` runs the type check and the coverage run for this package. `node scripts/verify-fresh-install.mjs` loads it from a fresh copy without `node_modules`. `bunx biome ci extensions/pi-xai-oauth --error-on-warnings --max-diagnostics=none`, `bun run check:agents`, `bun run check:tests`, and `node scripts/check-pi-mechanisms.mjs` check style and Pi packaging rules.
