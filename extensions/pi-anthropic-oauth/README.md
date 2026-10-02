# pi-anthropic-oauth

This Pi package lets a Claude Pro or Max subscription answer in Pi. Requests identify as Provider CLI. It registers a separate provider, `claude-subscription`, so the subscription login stays apart from the credentials of Pi's built-in `anthropic` provider.

The provider reuses Pi's own parts. It takes them from Pi's built-in `anthropic` provider, which `@earendil-works/pi-ai/providers/all` supplies to extensions. Pi's Claude Pro/Max OAuth flow handles login and refresh. Pi's Anthropic Messages implementation sends requests through `@anthropic-ai/sdk`, and the model list is Pi's bundled Anthropic catalog. Catalog updates that Pi downloads from pi.dev apply to Pi's own `anthropic` provider, not to this one. The package changes four things. It adds the Provider CLI billing block to each request, it keeps tool names unique after Pi's OAuth renaming, it caches the prompt for one hour, and it shrinks very large shell output before the model sees it.

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

To send a different Provider CLI version in the user agent, set the header in the `models.json` file of your agent directory. Pi sends a provider's headers on every request of that provider, compaction included, and they replace the default `user-agent`. Use the lowercase name.

```json
{
  "providers": {
    "claude-subscription": {
      "headers": { "user-agent": "claude-cli/2.1.300" }
    }
  }
}
```

The billing block keeps its captured version.

The package also checks the payload that Pi's Anthropic implementation hands over. It expects an object whose `system` is an array or absent. Any other shape ends the request with an error that names the unexpected shape.

## Tool names

For an OAuth token, Pi's Anthropic implementation renames tools to Provider CLI's names, so Pi's `read` tool goes out as `Read`. Two session tools whose names differ only in case fold into one name, and Anthropic rejects the request with `400` and the message `tools: Tool names must be unique.` Pi's own `Task` tool next to a custom tool named `task` is such a pair.

The package drops each duplicate after the first, so the request carries one tool per name. Pi maps a tool call back to the first case-insensitive match in the session's tools, so the kept tool is also the one such a call reaches. The model never sees the dropped tool. The renaming is Pi's, so a fix that keeps both tools belongs in Pi. If the model needs both tools, rename one of them at its registration.

A cache marker on a dropped last tool moves to the new last tool, so the request keeps its one-hour tool breakpoint.

## Prompt caching

Provider CLI writes its prompt cache with a one-hour lifetime (`cache_control: {"type":"ephemeral","ttl":"1h"}`). Pi's default is five minutes, so a pause longer than that makes the next turn pay for the whole prompt again. This provider asks Pi's Anthropic implementation for the one-hour tier on every request. Pi marks the system blocks, the last tool and the last message, and each marker carries the one-hour lifetime.

- `cacheRetention: "none"` still turns caching off. Pi's compaction uses it. Any other value, including `short`, becomes one hour.
- Each model declares `promptCache` of 3600 seconds for both tiers. Pi's cache warmer reads that lifetime, so it does not send refreshes for an entry that is still alive. Set the `cacheWarming` setting to `off` to disable the warmer.
- A live test on 2026-10-01 sent the same Pi prompt twice, more than six minutes apart. The five-minute default re-wrote all 8,905 prompt tokens. The one-hour tier read 8,906 tokens from cache. Pi's usage record also reported `cacheWrite1h`, so the gateway applied the one-hour tier without the `extended-cache-ttl` beta header.

## Large shell output

Provider CLI keeps shell output inline up to 30,000 characters. Above that it saves the output to a file and sends the model a preview of the first 2,000 characters with the file path. A capture of Provider CLI 2.1.287 on 2026-10-01 showed 30,000 characters inline and 40,000 replaced by a roughly 2,200 character preview. Pi's `bash` tool keeps the last 50KB of a long output in context.

`src/large-output.ts` is a second extension in the manifest. No Pi setting bounds the size of tool text, so it registers a `tool_result` handler, the documented way to rewrite a tool result, and acts only when the active model belongs to `claude-subscription`. Above 30,000 characters it replaces a `bash` result with the same kind of preview. If Pi already saved the full output, the handler previews that file. Otherwise it writes the output to a file in the system temp directory. If the file cannot be read or written, the original result stays. Other tools and other providers are untouched.

Measured on the live subscription with a 100,000 character command, the model received 51,332 characters without the handler and 2,208 with it. The follow-up turn wrote 51,381 tokens to cache without it and 2,204 with it.

## Where per-turn cost still differs from Provider CLI

A capture of Provider CLI 2.1.287 on 2026-10-01 (its own request to a local stub, with no credentials logged) and the same model through this provider differ in three places that touch tokens. Each one is a Pi setting, not provider code.

- **Thinking effort.** Provider CLI sent `output_config.effort: "medium"`. Pi sends the level from `modelThinkingLevels` or `defaultThinkingLevel` in `settings.json`. Thinking output is the largest controllable cost, so set `"claude-subscription/claude-sonnet-5-5": "medium"` there to match.
- **Thinking display.** Provider CLI asked for `display: "omitted"`. Pi asks for `"summarized"` so the transcript can show thinking. The thinking tokens are billed the same either way.
- **Prompt size.** Provider CLI's captured system and tool text was about 75,000 characters, roughly 20,000 tokens (estimate). A default Pi session with this package measured 21,551 tokens in this repository. Skills, `AGENTS.md` and extension tools set that number, and Pi's `compaction` settings bound its growth.

Both clients already agree on `max_tokens` (128000) and on adaptive thinking. Two other Provider CLI behaviors needed no change.

- Over 14 turns of 24KB `bash` results, Provider CLI kept every earlier result in full. It does not clear old tool output, and neither does Pi.
- Provider CLI refuses to read a file over 256KB and tells the model to use an offset and limit. Pi's `read` tool returns at most 50KB, which is already smaller.

## Where Pi has no mechanism

Pi supplies most of this package. The `/login` flow, token refresh, model catalog, and Anthropic Messages request are Pi's own, and the shell output cap is a `tool_result` handler. `models.json` cannot log in to a Claude subscription, so the package registers a provider that reuses those Pi parts.

Three request adjustments are code in `src/index.ts` because no Pi mechanism applies them to this provider's requests alone. They run inside the provider's `stream` and `streamSimple`, where the pi-ai README puts provider-wide request changes. Pi still builds the request, calls the caller's `onPayload` afterward, and owns the session, the tools, and the usage accounting. The tests check that aborts, usage and cost, context overflow, and credential refresh pass through the wrapper unchanged. The wrapper keeps no state, so a reload, a session replacement, or a branch switch cannot leave it stale.

**Billing block.** The gateway needs the block first in `system` on every request. The `before_provider_request` event can replace a payload, but it misses requests this package must cover. Compaction requests do not fire it. A virtual model that routes to this provider fires it with `ctx.model` naming the virtual selection, so a handler cannot tell that the request is for this provider. `scripts/prove-request-paths.ts` starts Pi 1.0.0 with `RpcClient` and runs three prompts, one compaction, and one prompt through a virtual model. The prompts sent 3 requests and fired 3 events. The compaction sent 2 requests and fired none. The virtual route sent 1 request and fired 1 event, which names the virtual model's provider. The `before_agent_start` event changes the Pi prompt, which Pi places after Provider CLI's preamble, so it cannot come first. No `models.json` field or setting edits a request body. Delete this code when `before_provider_request` fires for every request and names the provider that receives it. When that happens, the script fails and says so.

**One-hour cache.** `PI_CACHE_RETENTION=long` reaches every provider that reads it, not only this one. A stored OAuth credential resolves to a token without a provider environment, so this provider cannot set the variable for itself. `cacheRetention` is a per-request option, so the wrapper sets it. Delete this code when a provider or model can declare a default retention.

**Unique tool names.** Pi's OAuth rename creates the collision, and it exists only on the wire. The Pi mechanisms that remove a declaration do not fit. `setActiveTools()` and the `selectedTools` field of `before_agent_start` change the session's active tools. Pi records that change in the transcript and keeps it after a model change, so the hidden tool would stay hidden for other providers. `prepareLoadout` needs a registered tool that the model sees, and it receives no model, so it cannot act for this provider alone. `before_provider_request` cannot scope itself to this provider when a virtual model routes to it. The wrapper drops the later duplicate from the flat `tools` list after Pi's rename, one request at a time. Delete this code when pi-ai folds names before it declares tools.

## Verify it

Run `bun install` first. It installs the Pi packages the tests import, pinned to 1.0.0. Pi does not install development dependencies when it loads the package.

- `bun run typecheck` runs `tsc` in strict mode.
- `bun run test` calls the extension factory with a small typed fake of `registerProvider` to get the provider. Requests then go through Pi's `Models` to a local Messages server. The stored OAuth credential, bearer header, and refresh run the real path. Only the HTTP peer is faked. One test runs Pi's public `discoverAndLoadExtensions` on a temporary copy of the package to prove that Pi loads the file the `pi.extensions` manifest in `package.json` declares. A type check in the same suite fails if the default export stops being a Pi `ExtensionFactory`.
- `bun run test:coverage` runs the same tests and enforces the coverage thresholds. `src/index.ts` and `src/large-output.ts` are covered.
- `bunx vitest run --sequence.shuffle` runs the tests in random order to check that they are independent.
- `node --experimental-strip-types scripts/equivalence.ts` prints each captured request and result as JSON. To compare two versions, run it on both and diff the output.
- `node --experimental-strip-types scripts/prove-pi.ts` loads the extension in `pi`. If you are logged in, it sends one live prompt. If not, it confirms that Pi asks you to log in.
- `node --experimental-strip-types scripts/prove-request-paths.ts` starts Pi with `RpcClient` against a local gateway stub and runs three prompts, one compaction, and one prompt through a virtual model. It checks that every request carries the billing block, that `before_provider_request` does not fire for compaction, that it names the virtual model's provider for a virtual route, and that a `user-agent` header from `models.json` reaches every request.

From the repository root, `bunx biome ci extensions/pi-anthropic-oauth --error-on-warnings --max-diagnostics=none`, `bun run check:agents`, `bun run check:tests`, and `node scripts/check-pi-mechanisms.mjs` check style and Pi packaging rules.
