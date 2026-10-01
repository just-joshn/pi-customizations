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

The version becomes a request header, so the package checks it. A valid value is dotted digits with 2 to 4 groups, such as `2.1.280`. The package reads `options.env.CLAUDE_CODE_VERSION` first and `process.env.CLAUDE_CODE_VERSION` second. An empty string counts as unset. Any other value fails the request with an error that says `CLAUDE_CODE_VERSION must be dotted digits with 2 to 4 groups, such as 2.1.280` and quotes the rejected value. No request leaves your machine. Pi reports the failure as an error result on the stream. Headers you pass on a request still override the generated `user-agent`.

The package also checks the payload that Pi's Anthropic implementation hands over. It expects an object whose `system` is an array or absent. Any other shape ends the request with an error that names the unexpected shape.

## Verify it

Run `bun install` first. It installs the Pi packages the tests import, pinned to 0.99.2. Pi does not install development dependencies when it loads the package. The tests also pass against Pi 1.0.0. To check that, copy the package to a scratch directory, set both `@earendil-works/*` devDependencies to `1.0.0`, and run `bun install` there.

- `bun run typecheck` runs `tsc` in strict mode.
- `bun run test` calls the extension factory with a small typed fake of `registerProvider` to get the provider. Requests then go through Pi's `Models` to a local Messages server. The stored OAuth credential, bearer header, and refresh run the real path. Only the HTTP peer is faked. One test runs Pi's public `discoverAndLoadExtensions` on a temporary copy of the package to prove that Pi loads the file the `pi.extensions` manifest in `package.json` declares. A type check in the same suite fails if the default export stops being a Pi `ExtensionFactory`.
- `bun run test:coverage` runs the same tests and enforces the coverage thresholds. `src/index.ts` is fully covered.
- `bunx vitest run --sequence.shuffle` runs the tests in random order to check that they are independent.
- `node --experimental-strip-types scripts/equivalence.ts` prints each captured request and result as JSON. To compare two versions, run it on both and diff the output.
- `node --experimental-strip-types scripts/prove-pi.ts` loads the extension in `pi`. If you are logged in, it sends one live prompt. If not, it confirms that Pi asks you to log in.

From the repository root, `bunx biome ci extensions/pi-anthropic-oauth --error-on-warnings --max-diagnostics=none`, `bun run check:agents`, `bun run check:tests`, and `node scripts/check-pi-mechanisms.mjs` check style and Pi packaging rules.
