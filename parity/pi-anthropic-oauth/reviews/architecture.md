Delegating login to Pi's native Anthropic OAuth is still the right mechanism. The ambient token reorder does not fight Pi's credential store. The login and refresh wrappers do fight Pi's login contract.

## Confirmed

**The login and refresh wrappers break Pi's cancellation contract.** `subscriptionAuth` catches every failure from the native flow and, unless `interaction.signal` is already aborted, replaces it with a generic error.

```32:40:extensions/pi-anthropic-oauth/src/auth.ts
      login: async (interaction, options) => {
        interaction.signal.throwIfAborted();
        try {
          return await oauth.login(interaction, options);
        } catch {
          interaction.signal.throwIfAborted();
          throw new Error('Claude subscription login failed. Try /login again.');
        }
      },
```

Pi cancels the method picker and manual-code prompt by rejecting with the exact message `Login cancelled`, without aborting that signal (`interactive-mode.js` around 5204 and 5219). The dialog then treats only that exact string as cancel and calls `onBack()` (`interactive-mode.js` around 5298). This wrapper turns cancel, state mismatch, and a missing code into `Failed to login to Claude subscription: Claude subscription login failed. Try /login again.` The refresh wrapper at `auth.ts` 41–48 does the same to Pi's refresh error. `decisions.md` line 52 says cancellation must remain cancellation and only token-endpoint bodies must be wrapped. A blanket `catch` is wider than that, and it is not required by `OAuthAuth` in `pi-ai` `auth/types.d.ts`.

**The private billing fingerprint is still in the request path.** `identity.ts` 6–16 hardcodes salt `59cf53e54c78`, character indexes `[4, 7, 20]`, and `x-anthropic-billing-header`. That is not a Pi API. Ledger `OAUTH-003` calls the general function inconclusive and attributes the old claim to binary inspection. `decisions.md` line 24 rejects reading Claude's binary and importing its internals, but this reconstructed function is still what `index.ts` 90–94 prepends to every payload. Pi already inserts its own OAuth preamble, `You are Claude Code, Anthropic's official CLI for Claude.` (`anthropic-messages.js` around 888–906) and its own `claude-cli/2.1.280` user-agent (`anthropic-messages.js` 43 and 778). The extension stacks a second, private identity on top of that and overrides the user-agent to `2.1.296` (`index.ts` 79–91). The captured version string is an observation. The salt and indexes are not.

**A non-OAuth value in a higher-priority variable fails the provider instead of deferring.** `auth.ts` 8–12 throws when a non-empty value does not match `sk-ant-oat01-…`, and the loop at 18–22 returns on the first set variable. After the reorder, `ANTHROPIC_AUTH_TOKEN` is first. Pi's own docs say that variable is bearer authentication, not necessarily an OAuth access token (`docs/providers.md`, Anthropic paragraph; `providers/anthropic.js` 21–27). A non-`oat` bearer there throws `API key auth failed` from `resolve.js` and never reaches `CLAUDE_CODE_OAUTH_TOKEN`. That is fail-closed, and it is not what the order change measured.

## Login delegation

Keep delegating. Do not add a second OAuth client to chase the measured URL.

The difference is real. Installed Pi hardcodes `https://claude.ai/oauth/authorize` and scopes without `user:plugins` (`pi-ai/dist/auth/oauth/anthropic.js` 12 and 23). `decisions.md` lines 9–11 record Claude Code 2.1.296 printing `https://claude.com/cai/oauth/authorize` plus `user:plugins`. Client id, copy-code redirect, and token host match (`TOKEN_URL` is `https://platform.claude.com/v1/oauth/token`, same file line 13). `OAuthAuth.login` is opaque (`auth/types.d.ts` 216–230). The wrapper cannot rewrite the URL Pi notifies. Replacing `login` means reimplementing PKCE, the callback server, and token exchange.

That fork is not justified. The fake-code probe did not isolate the token path (`decisions.md` line 10; ledger `OAUTH-007`). Pi's `Models.login` still owns the store lock and the write (`models.js` login path). A second client would not own those any better, and it still could not be live-checked. `user:plugins` is outside this provider (`ledger.json` `OAUTH-024`). Delegation remains the right mechanism for `/login`, refresh, and `auth.json`. It is the wrong mechanism only if the release bar is Claude Code's authorize request. `OAUTH-007` should stay not verified. It should not be "fixed" by copying the flow.

## Ambient order and the store

The reorder does not fight the store.

Pi's rule is that a stored credential owns the provider id. Ambient env is consulted only when nothing is stored (`auth/resolve.js` 6–8 and 24–36). This provider id is `claude-subscription`, not `anthropic`. Stored OAuth never enters `subscriptionToken.resolve`. It uses the spread native `toAuth`, which returns `{ apiKey: credential.access }` (`anthropic.js` 256–258). A stored `api_key` is passed in as `credential`, and `auth.ts` 16 returns before `TOKEN_VARIABLES`. The new order cannot override `auth.json`, and it does not read or write the built-in `anthropic` entry. `decisions.md` lines 11 and 16 already say stored wins and that stored-versus-environment was not measured. That is alignment with the store, not a conflict.

What the order change actually is: among ambient variables only, `ANTHROPIC_AUTH_TOKEN`, then `CLAUDE_CODE_OAUTH_TOKEN`, then `ANTHROPIC_OAUTH_TOKEN` (`auth.ts` 3–4). That matches the measured print-mode pair and Pi's own anthropic env order for the first of those names (`providers/anthropic.js` 21–31). Keeping `ANTHROPIC_OAUTH_TOKEN` as a third alias follows Pi's docs, not Claude and not the store. Pi documents it as an API credential for provider `anthropic` (`docs/providers.md`; `env-api-keys.js` 72–75).

Related, and not caused by the reorder: ambient tokens are an `ApiKeyAuth` because `OAuthAuth` has no ambient resolve. `checkProviderAuth` then labels that success `api_key` (`models.js` around 276–278). `isUsingSubscription` is stored-oauth only (`model-runtime.js` 356–359). A setup token can authenticate a request and still not count as a subscription until `/login` writes an oauth credential. `decisions.md` and `ledger.json` do not say that.

## Not found

No invented Pi methods in these files. `registerProvider(Provider)`, `createProvider`, `builtinProviders`, `getDeclaredTools`, `appendEntry`, `OAuthAuth.login/refresh/toAuth`, and `StreamOptions` `onPayload`, `headers`, `cacheRetention`, and `sessionId` all exist on the installed 1.1.0 types. Spreading the lazy OAuth object and wrapping `login`/`refresh` while leaving `toAuth` and `isSubscription` in place is valid. `lazyOAuth` shares one load promise across those methods (`auth/helpers.js` 46–58).

Tool-name dropping (`index.ts` 40–66) is a workaround for Pi's own case-fold (`anthropic-messages.js` 67–68), not a fake API. Ledger `OAUTH-012` already says the second tool is lost. Forcing `cacheRetention` to `long` unless the caller passed `none` (`index.ts` 91) matches the code comment and `OAUTH-004`. It is a caller-visible limitation, but it is not an invalid field.

## Suspicions

`x-claude-code-session-id` (`index.ts` 79) is not in `decisions.md` or `ledger.json`. It is an assumed Claude header driven by Pi's `sessionId`. Pi already uses `sessionId` as an Anthropic cache session id when retention is not `none` (`anthropic-messages.js` 422–423). This second header is local mapping unless a capture shows Claude sends it.

`withUniqueToolNames` returns a non-object payload unchanged (`index.ts` 42), then `withBillingBlock` throws (`index.ts` 26). The early return is dead on this path. Not harmful.

`modelForCaseCollisions` (`index.ts` 68–74) only matters for models with both mid-conversation flags set. Current Anthropic catalog entries do set those flags, so this is live, not dead. It is a second mechanism beside payload dedupe. Both are there because Pi can put tools either in the request list or in inline tool-change blocks. I would not delete it without a test that covers that catalog.
