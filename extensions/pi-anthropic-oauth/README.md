# pi-anthropic-oauth

This Pi package lets a Claude Pro or Max subscription answer in Pi. Requests identify as Claude Code. It registers a separate provider, `claude-subscription`, so the subscription login stays apart from the credentials of Pi's built-in `anthropic` provider.

The provider reuses Pi's own parts. It takes them from Pi's built-in `anthropic` provider, which `@earendil-works/pi-ai/providers/all` supplies to extensions. Pi's Claude Pro/Max OAuth flow handles login and refresh. Pi's Anthropic Messages implementation sends requests through `@anthropic-ai/sdk`, and the model list is Pi's bundled Anthropic catalog. Catalog updates that Pi downloads from pi.dev apply to Pi's own `anthropic` provider, not to this one. The package changes three things. It adds the Claude Code billing block to each request, it caches the prompt for one hour, and it shrinks very large shell output before the model sees it.

## Use it

From this directory:

```bash
pi -e .
```

Then run `/login` and choose **Claude subscription (Claude Code)**. Pick a `claude-subscription` model with `/model`.

To keep the package for later sessions, run `pi install` with the path to this directory, or publish the package and install that npm name.

## What Anthropic sees

Pi's Anthropic implementation treats the subscription token as an OAuth token. It sends bearer auth, `user-agent: claude-cli/2.1.280`, `x-app: cli`, and the `claude-code-20250219` and `oauth-2025-04-20` beta features. It also sends the SDK's `x-stainless-*` headers, as Claude Code does.

The first system block is the Claude Code billing header (`x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;`). Anthropic's subscription gateway uses that block to bill the request to the Claude Code plan. A live test on 2026-09-27 showed the effect of removing it: the gateway returned HTTP 400 with an out-of-extra-usage error, even when the plan had usage left. The second system block is Claude Code's preamble, followed by the Pi system prompt.

To send a different version in the user agent, set `CLAUDE_CODE_VERSION`. The billing block keeps its captured version.

The version becomes a request header, so the package checks it. A valid value is dotted digits with 2 to 4 groups, such as `2.1.280`. The package reads `options.env.CLAUDE_CODE_VERSION` first and `process.env.CLAUDE_CODE_VERSION` second. An empty string counts as unset. Any other value fails the request with an error that says `CLAUDE_CODE_VERSION must be dotted digits with 2 to 4 groups, such as 2.1.280` and quotes the rejected value. No request leaves your machine. Pi reports the failure as an error result on the stream. Headers you pass on a request still override the generated `user-agent`.

The package also checks the payload that Pi's Anthropic implementation hands over. It expects an object whose `system` is an array or absent. Any other shape ends the request with an error that names the unexpected shape.

## Prompt caching

Claude Code writes its prompt cache with a one-hour lifetime (`cache_control: {"type":"ephemeral","ttl":"1h"}`). Pi's default is five minutes, so a pause longer than that makes the next turn pay for the whole prompt again. This provider asks Pi's Anthropic implementation for the one-hour tier on every request. Pi marks the system blocks, the last tool and the last message, and each marker carries the one-hour lifetime.

- `cacheRetention: "none"` still turns caching off. Pi's compaction uses it. Any other value, including `short`, becomes one hour.
- Each model declares `promptCache` of 3600 seconds for both tiers. Pi's cache warmer reads that lifetime, so it does not send refreshes for an entry that is still alive. Set the `cacheWarming` setting to `off` to disable the warmer.
- A live test on 2026-10-01 sent the same Pi prompt twice, more than six minutes apart. The five-minute default re-wrote all 8,905 prompt tokens. The one-hour tier read 8,906 tokens from cache. Pi's usage record also reported `cacheWrite1h`, so the gateway applied the one-hour tier without the `extended-cache-ttl` beta header.

## Large shell output

Claude Code keeps shell output inline up to 30,000 characters. Above that it saves the output to a file and sends the model a preview of the first 2,000 characters with the file path. A capture of Claude Code 2.1.287 on 2026-10-01 showed 30,000 characters inline and 40,000 replaced by a roughly 2,200 character preview. Pi's `bash` tool keeps the last 50KB of a long output in context.

`src/large-output.ts` is a second extension in the manifest. It registers a `tool_result` handler, the documented way to rewrite a tool result, and acts only when the active model belongs to `claude-subscription`. Above 30,000 characters it replaces a `bash` result with the same kind of preview. If Pi already saved the full output, the handler previews that file. Otherwise it writes the output to a file in the system temp directory. If the file cannot be read or written, the original result stays. Other tools and other providers are untouched.

Measured on the live subscription with a 100,000 character command, the model received 51,332 characters without the handler and 2,208 with it. The follow-up turn wrote 51,381 tokens to cache without it and 2,204 with it.

## Where per-turn cost still differs from Claude Code

A capture of Claude Code 2.1.287 on 2026-10-01 (its own request to a local stub, with no credentials logged) and the same model through this provider differ in three places that touch tokens. Each one is a Pi setting, not provider code.

- **Thinking effort.** Claude Code sent `output_config.effort: "medium"`. Pi sends the level from `modelThinkingLevels` or `defaultThinkingLevel` in `settings.json`. Thinking output is the largest controllable cost, so set `"claude-subscription/claude-sonnet-5-5": "medium"` there to match.
- **Thinking display.** Claude Code asked for `display: "omitted"`. Pi asks for `"summarized"` so the transcript can show thinking. The thinking tokens are billed the same either way.
- **Prompt size.** Claude Code's captured system and tool text was about 75,000 characters, roughly 20,000 tokens (estimate). A default Pi session with this package measured 21,551 tokens in this repository. Skills, `AGENTS.md` and extension tools set that number, and Pi's `compaction` settings bound its growth.

Both clients already agree on `max_tokens` (128000) and on adaptive thinking. Two other Claude Code behaviors needed no change.

- Over 14 turns of 24KB `bash` results, Claude Code kept every earlier result in full. It does not clear old tool output, and neither does Pi.
- Claude Code refuses to read a file over 256KB and tells the model to use an offset and limit. Pi's `read` tool returns at most 50KB, which is already smaller.

## Verify it

Run `bun install` first. It installs the Pi packages the tests import, pinned to 0.99.2. Pi does not install development dependencies when it loads the package. The tests also pass against Pi 1.0.0. To check that, copy the package to a scratch directory, set both `@earendil-works/*` devDependencies to `1.0.0`, and run `bun install` there.

- `bun run typecheck` runs `tsc` in strict mode.
- `bun run test` calls the extension factory with a small typed fake of `registerProvider` to get the provider. Requests then go through Pi's `Models` to a local Messages server. The stored OAuth credential, bearer header, and refresh run the real path. Only the HTTP peer is faked. One test runs Pi's public `discoverAndLoadExtensions` on a temporary copy of the package to prove that Pi loads the file the `pi.extensions` manifest in `package.json` declares. A type check in the same suite fails if the default export stops being a Pi `ExtensionFactory`.
- `bun run test:coverage` runs the same tests and enforces the coverage thresholds. `src/index.ts` and `src/large-output.ts` are covered.
- `bunx vitest run --sequence.shuffle` runs the tests in random order to check that they are independent.
- `node --experimental-strip-types scripts/equivalence.ts` prints each captured request and result as JSON. To compare two versions, run it on both and diff the output.
- `node --experimental-strip-types scripts/prove-pi.ts` loads the extension in `pi`. If you are logged in, it sends one live prompt. If not, it confirms that Pi asks you to log in.

From the repository root, `bunx biome ci extensions/pi-anthropic-oauth --error-on-warnings --max-diagnostics=none`, `bun run check:agents`, `bun run check:tests`, and `node scripts/check-pi-mechanisms.mjs` check style and Pi packaging rules.
