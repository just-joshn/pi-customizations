# Claude OAuth parity

The current identity reference is locally installed Claude Code `2.1.296`, captured through `scripts/capture-claude.py` against a loopback server with a synthetic token and an OS sandbox denying non-localhost networking and real credential-directory reads. The `2.1.288` fixture remains historical evidence. This identity update inspected no Claude binary contents or private source. Older fingerprint, OAuth, and context claims below originated in historical binary inspection; they are not independently clean-room confirmed current Claude requirements. Local target tests establish target behavior, not source parity. See `parity/pi-anthropic-oauth/identity-update.md` in the repository for current identity observations and limits.

## Verification boundary

`VERIFIED` means a local test or real Pi CLI probe establishes the named behavior. It does not mean Anthropic accepted a live subscription request. `NATIVE DIFFERENCE` identifies behavior deliberately left with Pi. `INCONCLUSIVE` identifies an unverified external result.

| Behavior | Result | Evidence or boundary |
| --- | --- | --- |
| Bearer authentication without `x-api-key` | VERIFIED | `test/request-identity.test.ts` and `scripts/prove-native.ts` exercise native Pi streams. |
| Claude SDK user agent and `x-app` | MEASURED reference; VERIFIED locally | Current synthetic SDK capture sends `claude-cli/2.1.296 (external, sdk-cli)` and `x-app: cli`. Current local request tests check the target headers. Historical CLI receipts do not verify the new version. |
| Dynamic billing attribution | MEASURED for selected text inputs | Current capture sends `2.1.296.c4b` for `Reply LOCAL_OK.`. Independent length-boundary and Unicode captures agree with the existing target rule at the new version. Empty/image/multi-turn/concurrency tests remain target-only regressions, not current Claude observations. |
| Session correlation | LOCAL MAPPING | `x-claude-code-session-id` uses Pi's supplied `sessionId`. The RPC probe compares it with native session state. The Claude capture does not record that header, so this is not source equivalence. |
| One-hour request cache markers | VERIFIED | `test/prompt-cache.test.ts` verifies `ttl: "1h"` and the uncached billing block. Explicit retention `none` remains uncached. |
| Native copy-code OAuth | LOCAL ONLY | Pi supplies authorization, PKCE, state checks, exchange, and persistence. Copy-code exchange and cancellation have local tests. This is not a completed Claude login comparison. |
| Complete browser OAuth callback flow | INCONCLUSIVE | The native callback flow remains unchanged. Neither a full local browser-callback exchange nor a complete live browser login was attempted. |
| Token refresh and rotation | LOCAL ONLY | Native Pi credential locking refreshes concurrent requests once. Failed refresh preserves the stored credential. Synthetic token-endpoint tests do not establish Claude refresh timing or live token validity. |
| Setup tokens and standard ambient aliases | VERIFIED | Native auth resolution accepts `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, and subscription-shaped `ANTHROPIC_AUTH_TOKEN`. The real CLI probe leaves the credential store empty. |
| Credential precedence | NOT SOURCE-EQUIVALENT | Pi's stored credential still wins over ambient tokens; Claude's stored-versus-environment order was not measured. Among ambient subscription tokens, `ANTHROPIC_AUTH_TOKEN` now outranks `CLAUDE_CODE_OAUTH_TOKEN`, matching Claude Code `2.1.296` print mode and `auth status`. Claude ignores `ANTHROPIC_OAUTH_TOKEN`; this provider still accepts an OAuth-shaped value after the two variables Claude uses. Claude can select `ANTHROPIC_API_KEY` over a setup token and send `x-api-key`. This subscription provider rejects that fallback. |
| OAuth authorization URL and scopes | NOT SOURCE-EQUIVALENT | A clean-room `claude auth login --claudeai` on Claude Code `2.1.296` printed `https://claude.com/cai/oauth/authorize` and requested `user:plugins` in addition to Pi's scopes. The client id and copy-code redirect match Pi. Pi's native login remains `https://claude.ai/oauth/authorize` without `user:plugins`. Replacing that login was rejected: the token-endpoint path was not isolated, and no live exchange was authorized. |
| Refresh protocol and expiry margins | NATIVE DIFFERENCE | Pi owns the refresh request, timeout, proactive validity window, and token storage. The extension adds no second refresh manager. |
| OAuth error confidentiality | VERIFIED | `test/auth-boundaries.test.ts` and `test/claude-parity.test.ts` prevent native error response bodies from escaping. Abort reasons remain cancellation, not generic auth failures. |
| Stream hooks, text, tools, images, usage, Unicode, errors, overflow, and aborts | VERIFIED locally | Existing native-stream suites exercise these contracts through the adapter and a loopback gateway. |
| Compaction and virtual routes | VERIFIED | `scripts/prove-request-paths.ts` reaches the same physical provider adapter on pinned Pi `1.1.0` (`docs/verification/pi-1.1.0-paths.json`). Historical receipts cover Pi `1.0.0` and `1.0.1`. |
| Fork, reload, and session replacement | VERIFIED | `scripts/prove-native.ts` checks fresh request-local fingerprints and successful native tool execution after runtime changes. |
| Tool-name collisions | KNOWN LIMITATION | Native OAuth renaming folds names such as `Task` and `task`. The existing compatibility adapter keeps the first declaration. The second tool remains unavailable on that request. `test/tool-name-collision.test.ts` records the behavior. |
| Context-window accounting and compaction timing | NOT SOURCE PARITY | `src/context/tokens.ts` supplies local per-block estimates and thresholds, `src/context/guard.ts` compacts at `agent_settled` when the usage-calibrated estimate reaches the configured compact threshold, and `src/context/fit.ts` attempts to fit outgoing requests under the estimated blocking threshold. These checks do not establish Claude Code accounting or compaction parity. `scripts/prove-context-guard.ts` reproduces the over-limit wedge on the parent commit and verifies the fix on pinned Pi `1.2.0` (also previously on Pi `1.0.2` / `1.0.3` / `1.1.0`). The synthetic endpoint does not establish live acceptance. |
| Prompt shape, thinking display, output limits, and tool results | NATIVE DIFFERENCE | Pi owns these. The captured Claude SDK preamble, omitted-thinking display, and output limit are not imposed on Pi. Bash uses Pi's native output policy, including 40,000-character inline output in the CLI probe. |
| Optional Claude beta flags and account metadata | NATIVE DIFFERENCE | Pi sends features it implements. Claude-specific safeguards, plugin protocols, account/device telemetry, previous-request IDs, and private workload flags are not copied or fabricated. |
| Model catalog and entitlement filtering | NATIVE DIFFERENCE | The provider uses Pi's bundled Anthropic catalog at registration. It does not copy Claude aliases or maintain a second live model catalog. |
| Claude Code credential-file and Keychain sharing | NATIVE DIFFERENCE | Pi's credential store is authoritative. The extension does not read, import, mutate, or synchronize Claude Code credentials. |
| Live login, subscription entitlement, billing attribution, and cache acceptance | INCONCLUSIVE | No complete live login or authenticated Anthropic inference was performed in this refactor. Local shape equality cannot establish server acceptance or subscription billing. |

The newer authorization URL redirected and then returned HTTP 403 during a probe with Pi's parameters. That result does not prove incompatibility. It also does not justify replacing a native login flow with an unverified URL adaptation.

## Request identity

The current captured version is `2.1.296`. The existing target rule samples JavaScript string indices `4`, `7`, and `20` from the first user text, substituting `0` for missing characters, and hashes its pinned salt, that sample, and the version with SHA-256, using the first three hexadecimal characters. Eleven independent current text captures match this rule. That is finite black-box agreement, not proof of the private algorithm, its origin, or arbitrary-input equivalence.

Pi's normalized request transcript supplies the first user text. No separate session or branch state is retained. Compaction and branch changes therefore use the first user text in the new request context. Pi does not expose Claude Code's private `isMeta` message classification, so this is request-context equivalence rather than private-session-state equivalence.

This identity is captured Claude Code attribution, not native Pi attribution. The local captures do not establish permission under Anthropic's current terms. Review those terms before using a subscription with this client.

The salt and sample indices are pre-existing historically reverse-engineered target constants, not newly clean-room-confirmed source facts. Only the version changes in this update. A Claude Code or gateway update can invalidate the rule. Recapture independent vectors before updating these constants. The request-path probe pins the target hash `2.1.296.eb7` for the prompt `first`. That prompt was not in the Claude capture fixture, so the pin is a target regression, not an independent Claude observation. Changing the prompt requires a new measured vector before it can be treated as source parity.

The billing block is first and uncached. Existing attribution blocks are replaced rather than duplicated. The caller's `onPayload` runs afterward and retains Pi's replacement semantics, including the ability to replace the whole payload. Such a replacement is caller-owned and can remove the attribution block.

## Context accounting and the request cap

A session built on another provider can be over Anthropic's limit before its first subscription request. Pi's `estimateContextTokens` anchors on the last assistant `usage`, whatever provider produced it, and estimates appended content at `chars/4`. A real session switched from a provider that counted the same content at roughly 4.5 characters per token to `claude-subscription`, so Pi estimated well under the window while Anthropic counted `1,036,487 tokens > 1,000,000`. The endpoint rejected the prompt, and the one-shot overflow-recovery summarization request was itself over the limit, so no compaction entry landed and the session stayed wedged.

Three modules address it.

- `src/context/tokens.ts` owns Claude Code's accounting: `Math.round(utf8Bytes / bytesPerToken)` per content block, 4 bytes for the 14 legacy and family model names and 3 for every other name, `compactAt = contextWindow - min(maxTokens, 20000) - 13000`, and `blockAt = ... - 3000`. Claude Code's auto-compact window resolves to the context window for every model in Pi's catalog, so `min(contextWindow, autoWindow)` collapses.
- `src/context/guard.ts` registers an `agent_settled` handler. When a run that was not aborted settles and the projected context, rendered system prompt, and active tool declarations reach `compactAt`, it calls `ctx.compact()` once and awaits the completion or error callback, so the next request starts on the compacted projection. A `Nothing to compact (session too small)` or `Already compacted` failure is informational and resolves quietly; other failures are reported once per session. Pi `1.2.0` counts the session as busy during `before_agent_start`, so compaction there aborts the starting run and deadlocks when awaited, as it does from `turn_start`, `turn_end`, and `agent_before_settle`; an empirical probe on Pi `1.2.0` RPC and print mode established `agent_settled` as the safe point. The first request after a resume or a switch to the subscription model is not compacted beforehand; `src/context/fit.ts` keeps it under the window. Pi still owns summarization, the session store, and persistence.
- `src/context/fit.ts` fits the exact outgoing payload under `blockAt`. For a full conversation it drops the smallest prefix that ends before a kept, text-only user message, prepends a one-line marker as a plain text block, and preserves every existing block and its `cache_control`. For Pi's summarization requests, identified by their system prompt and including the trailing output-config system message, it shrinks the serialized conversation head-and-tail so the summarization request itself fits. The fit is request-local: the session history is never modified, and the next successful compaction realigns it.

Deliberate deviations from the parity source:

- The estimator measures UTF-8 bytes rather than Claude Code's UTF-16 `.length`. That is conservative for CJK and base64 content, never optimistic.
- The seed bias of `1.2` covers the measured 1.14 undercount before a session has a measurement. After each successful subscription response, `(input + cacheRead + cacheWrite) / payloadTokens(payload)` recalibrates it within `[1, 2]`. Summarization payloads do not recalibrate it, so their prose density cannot re-tune the conversation, and `session_start` resets it.
- The marker is request-local and carries no counts, so a retried request cannot drift.

Boundaries:

- The guard runs at the prompt boundary. Mid-run growth, extension-injected messages, and virtual-router sessions rely on the payload fit only.
- A single message larger than the model window cannot be fixed without discarding the user's prompt. The fit returns the payload unchanged and the endpoint's rejection surfaces as it does today.
- Compaction has no wall-clock timeout on purpose. A timeout would release the handler while Pi still holds the compaction controller. If Pi ever failed to settle a compaction, the prompt would wait.
- Content denser than about 2.1 bytes per token can exceed the window before the session's first usable measurement. After a measurement the bias follows the endpoint's observed usage-to-payload-estimate ratio, clamped to `[1, 2]`; lower observed usage removes inflation but does not reduce the multiplier below `1`.
- The probe's endpoint is a synthetic tokenizer. It proves the mechanism and the payload invariants, not live service acceptance. Live login, billing attribution, and endpoint acceptance remain INCONCLUSIVE.

## Native API gaps

### Provider-local request adjustment

The required behavior is subscription identity and cache policy on every physical subscription request, including compaction and virtual routes. The evaluated mechanisms are `models.json`, `before_agent_start`, `before_provider_request`, and provider stream options.

`models.json` expresses static headers but not a request-derived billing body. Prompt hooks cannot put that block before Pi's OAuth preamble. On both tested Pi versions, compaction does not fire `before_provider_request`, and a virtual route reports the selected virtual model rather than the physical provider. The request-path probe makes those gaps executable assertions.

The smallest adapter delegates `stream` and `streamSimple` to native Anthropic while composing public options. It owns no transport, retry, request queue, session, tool execution, or usage accounting. The native-stream suites and real CLI probes verify hooks, cancellation, compaction, routing, and accounting through that boundary.

The provider declares one-hour best-effort cache lifetimes because its request policy emits one-hour cache markers. It does not implement cache warming. Global `PI_CACHE_RETENTION` would change unrelated providers, so retention remains subscription-local.

This adapter can shrink when public provider defaults express cache retention and a request-transform API covers every physical request with the receiving provider identified. `prove-request-paths.ts` fails if the observed event gaps change.

### Native OAuth tool-name collisions

The required behavior is a request Anthropic can accept when native OAuth tool renaming creates duplicate names. The evaluated public mechanisms are active-tool selection, `prepareLoadout`, and request events.

Active-tool selection changes session-owned declarations and can persist across provider changes. `prepareLoadout` has no physical-model scope. Request events have the compaction and virtual-route gaps above. None supplies lossless per-provider renaming and response mapping.

Pi `1.1.0` (and earlier `1.0.1`) sends tool changes inline on capable models. The upstream migration's request-local model adjustment is preserved. Public `getDeclaredTools()` detects colliding identities in the transcript, then `supportsMidConvoToolChanges: false` selects native current-tool conversion for that request. Other transcripts retain inline additions, removals, and redefinitions. No separate tool history is retained.

The existing wire-only deduplication remains the smallest compatibility adapter, but it is lossy and is not full tool parity. It preserves the first declaration and relocates a dropped last-tool cache marker. Native Pi still owns the registry, permissions, execution, and response mapping. The collision suite checks these declared wire results, while the real CLI probe verifies ordinary tool round-trips.

The adapter can be deleted when native Pi preserves unique declarations and maps each response unambiguously. Removing it now would reintroduce duplicate-name failures rather than close the gap.

### Authentication error sanitization

The required behavior is failure reporting without token-endpoint response bodies. Native OAuth remains responsible for login and refresh. Its current failures can include complete server bodies and nested stack text.

The adapter replaces non-cancellation login and refresh errors with bounded recovery messages. It retains the native credential transaction and propagates the operation's abort reason. No new HTTP client, credential store, callback server, or refresh lock is introduced.

This wrapper can be removed when native OAuth errors guarantee the same confidentiality contract. The synthetic-response tests make that contract explicit.
