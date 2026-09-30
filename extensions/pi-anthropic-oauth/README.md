# pi-anthropic-oauth

This Pi package lets a Claude Pro or Max subscription answer in Pi. Requests identify as Provider CLI. It registers a separate provider, `claude-subscription`, so the subscription login stays apart from the credentials of Pi's built-in `anthropic` provider.

The provider reuses Pi's own parts. It takes them from Pi's built-in `anthropic` provider, which `@earendil-works/pi-ai/providers/all` supplies to extensions. Pi's Claude Pro/Max OAuth flow handles login and refresh. Pi's Anthropic Messages implementation sends requests through `@anthropic-ai/sdk`, and the model list is Pi's bundled Anthropic catalog. Catalog updates that Pi downloads from pi.dev apply to Pi's own `anthropic` provider, not to this one. The package adds one thing to each request: the Provider CLI billing block.

## Use it

From this directory:

```bash
pi -e .
```

Then run `/login` and choose **Claude subscription (Provider CLI)**. Pick a `claude-subscription` model with `/model`.

To keep the package for later sessions, run `pi install` with the path to this directory, or publish the package and install that npm name.

## What Anthropic sees

Pi's Anthropic implementation treats the subscription token as an OAuth token. It sends bearer auth, `user-agent: claude-cli/2.1.280`, `x-app: cli`, and the `claude-code-20250219` and `oauth-2025-04-20` beta features. It also sends the SDK's `x-stainless-*` headers, as Provider CLI does.

The first system block is the Provider CLI billing header (`x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;`). Anthropic's subscription gateway uses that block to bill the request to the Provider CLI plan. A live test on 2026-09-27 showed the effect of removing it: the gateway returned HTTP 400 with an out-of-extra-usage error, even when the plan had usage left. The second system block is Provider CLI's preamble, followed by the Pi system prompt.

To send a different version in the user agent, set `CLAUDE_CODE_VERSION`. The billing block keeps its captured version.

## Verify it

Run `bun install` first. It installs the Pi packages the tests import, pinned to 0.99.2. Pi does not install development dependencies when it loads the package.

- `bun run typecheck` runs `tsc` in strict mode.
- `bun run test` runs the provider against a local Messages server and checks the request and the Pi result.
- `node --experimental-strip-types scripts/equivalence.ts` prints each captured request and result as JSON. To compare two versions, run it on both and diff the output.
- `node --experimental-strip-types scripts/prove-pi.ts` loads the extension in `pi`. If you are logged in, it sends one live prompt. If not, it confirms that Pi asks you to log in.
