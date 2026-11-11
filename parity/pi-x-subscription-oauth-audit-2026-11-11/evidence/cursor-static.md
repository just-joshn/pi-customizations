# Cursor half: static parity with cursor-agent 2026.11.05-86047df

Goal: show whether the `cursor` provider in `pi-x-subscription-oauth` behaves exactly like the installed Cursor CLI. This slice is a read-only static comparison of the extension source against the CLI bundle at `~/.local/share/cursor-agent/versions/2026.11.05-86047df/`. No auth state was changed. Token values were never printed.

Extension paths below are relative to `extensions/pi-x-subscription-oauth/`. Bundle paths are relative to the version directory.

## Method (rerunnable)

The bundle uses protobuf-es v1 classes with compact descriptors: `static $(){return["Msg|<no> <name> <type>|..."]}`. In the type column, `9` = string, `8` = bool, `12` = bytes, `13` = uint32, `3` = int64, `4` = uint64, `#N` = message or enum, `?` = optional, and `*` = repeated. The command below dumps every descriptor (6,329 messages):

```sh
cd ~/.local/share/cursor-agent/versions/2026.11.05-86047df
rg -o --no-filename 'static \$\(\)\{return\["[^"]*"' *.js | sed 's/static \$(){return\["//; s/"$//' | sort -u > /tmp/ca-audit/desc.txt
grep -E '^(AgentClientMessage|AgentRunRequest|UserMessage|RequestedModel|InteractionUpdate|TurnEndedUpdate|ExecServerMessage|ExecClientMessage)\|' /tmp/ca-audit/desc.txt
```

Webpack keeps module paths as keys (for example `"./src/auth-refresh.ts"(t,e,r){...}`), so each snippet below names its source module.

## Verdict table

| # | Row | Verdict |
|---|-----|---------|
| 1a | macOS keychain services and account | MATCH |
| 1b | Linux and Windows storage | MISMATCH (extension is macOS-only) |
| 1c | access token equals refresh token | MATCH (same JWT, 1 h lifetime) |
| 1d | refresh mechanism (API key exchange, 5 min skew) | MATCH, with gaps (no `CURSOR_API_KEY` fallback, and no keychain write-back) |
| 2 | `/auth/exchange_user_api_key` | MATCH (except the optional MDM header and the 403 policy error) |
| 3a | GetUsableModels path and body | MATCH |
| 3b | GetUsableModels headers | MISMATCH (`x-ghost-mode` is hard-coded false, and timezone and team id are missing) |
| 3c | Model list and metadata | MISMATCH (displayModelId, parameters, context, and images are discarded) |
| 4a | Run host | MISMATCH (CLI uses `agentn.global.api5.cursor.sh` from the server config) |
| 4b | Run headers | MISMATCH (ghost mode and timezone are hard-coded; `x-blob-encryption-key` and `x-original-request-id` are missing) |
| 5 | Run frame field numbers | MATCH (every number, type, and nesting is correct; `--mode ask` maps to 2) |
| 5b | RequestedModel parameters | MISMATCH (`fast=false` for every model; CLI sends per-model saved or default variant parameters) |
| 6a | Text delta and turn end decode | MATCH (field 1.1 and field 14) |
| 6b | Exec requests other than request_context, KV, and interaction queries | MISMATCH (extension never replies, so the turn stalls until the 120 s deadline) |
| 6c | Heartbeats and stream_close | MISMATCH (CLI sends a client heartbeat every 5 s, exec heartbeats every 3 s, stream_close after each exec, and HTTP/2 pings every 10 s; extension sends none) |
| 6d | RequestContext reply | MISMATCH (empty reply versus env, rules, git, tools, and skills) |
| 7 | Multi-turn | MISMATCH (CLI has a structured `conversation_history`; extension flattens the transcript into one string with a random conversation id) |
| 8 | Error mapping | MISMATCH (CLI decodes binary `aiserver.v1.ErrorDetails` and retries; extension only string-matches the JSON debug field) |
| 9 | Token usage | MISMATCH (server sends `TurnEndedUpdate` tokens; the native path reports zero) |
| 10 | `--print --output-format json` result schema | MATCH |

---

## 1. Credential storage and refresh

**CLI** — `index.js`, credential manager factory and keychain class:

```js
const e=function(t){const e=t.trim();return{account:`${e}-user`,accessTokenService:`${e}-access-token`,
  refreshTokenService:`${e}-refresh-token`,apiKeyService:`${e}-api-key`, ...
function h(t){const e=t.store??"default";return"memory"===e?new f:"file"===e?new l(t.domain)
  :"darwin"===(0,n.platform)()?new p(t.domain):new l(t.domain)}
... (0,n.jo)({domain:"cursor",store:e})   // e from AGENT_CLI_CREDENTIAL_STORE = file|memory|default
getAuthFilePath(t){switch(platform()){case"win32":... join(APPDATA, "Cursor","auth.json");
  case"darwin":return join(homedir(),`.${t}`,"auth.json");
  default:{const e=process.env.XDG_CONFIG_HOME||join(homedir(),".config");return join(e,t,"auth.json")}}}
// file store body: {accessToken, refreshToken, apiKey, bedrockCredentials}, mode 0600
```

- The macOS default is keychain account `cursor-user`, with the services `cursor-access-token`, `cursor-refresh-token`, and `cursor-api-key`. The extension uses the same names (`src/cursor/auth.ts:6-9`, read through `security find-generic-password` at `auth.ts:47-58`). **MATCH.**
- On Linux the CLI uses `$XDG_CONFIG_HOME/cursor/auth.json` (or `~/.config/cursor/auth.json`). On Windows it uses `%APPDATA%\Cursor\auth.json`. On macOS with `AGENT_CLI_CREDENTIAL_STORE=file` it uses `~/.cursor/auth.json`. The CLI also accepts the `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN` env vars and the `--api-key` and `--auth-token` flags. The extension reads only the macOS keychain. **MISMATCH** on Linux, on Windows, on the macOS file store, and for env-var auth.
- Live keychain shape (values not printed): access and refresh each have len 449, 3 segments, and `type=api_key_token`. Claims: `apiKeyId, aud, exp, iss, randomness, scope, sub, time, type`, with `exp - time = 3600 s`. `access == refresh` is **True**. `cursor-api-key` has len 69 and 1 segment. **MATCH** with the README's claim (README.md:39).

**Refresh — CLI** (`"./src/auth-refresh.ts"`):

```js
function l(t){... return ... n-r<300}           // expiring if exp - now < 300 s
async function f(t,e){const{endpoint:r,apiKeyOverride:o}=e,
  a=o??c??await t.getApiKey()??process.env.CURSOR_API_KEY; if(!a)return null;
  l=await u.loginWithApiKey(a,{endpoint:r}) ... await t.setAuthentication(e,r,a)  // persists back to keychain
async function h(t,e){... (0,s.Z)({currentToken:r,ephemeralToken:a,isTokenExpiringSoon:l,refreshToken:...})}
// token-refresh-policy: i?n(i)?await s()??i:i:await s()   -> falls back to the stale token if refresh yields null
```

- The CLI never uses the refresh token as a grant. It re-exchanges the API key. The extension does the same (`auth.ts:143-155`), with a 5 min skew (`auth.ts:13`, `sessionUsable` at `auth.ts:98-100`). **MATCH.**
- Gaps: the extension has no `CURSOR_API_KEY` fallback (`provider.ts:18` reads the keychain only). The extension never writes the minted token back to the keychain, so the CLI's own keychain token is not refreshed by Pi (harmless, because the CLI refreshes itself). The CLI falls back to the stale token when exchange returns null. The extension throws `CURSOR_LOGIN_HINT`.

## 2. `/auth/exchange_user_api_key`

**CLI** (`"../cursor-config/dist/auth/login.js"`):

```js
const e=(0,s.XX)({"Content-Type":"application/json",Authorization:`Bearer ${t}`,...n}),   // n = MDM header if policy
a=await i(`${r}/auth/exchange_user_api_key`,{method:"POST",headers:e,body:JSON.stringify({})});
if(403===a.status){if(x(await a.json()...))throw new m;return null}   // SignInPolicyViolationError
if(a.status>=500)throw new P(...); if(!a.ok)return null;
// valid iff accessToken non-empty string and refreshToken absent or non-empty string
```

**Extension** `auth.ts:108-120`: POST, `Content-Type: application/json`, `Authorization: Bearer <apiKey>`, body `'{}'`, then `mintedFrom` reads `accessToken` and optional `refreshToken` (`auth.ts:102-106`). **MATCH.** Differences: the CLI adds `x-cursor-mdm-signin-policy` only when a managed-preferences policy exists, adds `local-cli-mode` only in local mode, and maps 403 with a policy body to a dedicated error. The extension folds every failure into the login hint.

## 3. GetUsableModels and the model list

**CLI** (`3723.index.js`, `"./src/models/model-service.ts"` and the `--list-models` handler):

```js
async function c(e,t){const{models:s}=await e.getUsableModels(new o.KD({customModelIds:t??[]}));...}
async function d(e){const{model:t}=await e.getDefaultModelForCli(new o.Tu({}));return t}
async function u(e,t){const s=await e.availableModels(new n.p9_({useModelParameters:!0,doNotUseMarkdown:!0,additionalModelNames:t??[]})) ...
// --list-models:
const e=void 0===A?v??[]:(v??[]).filter((e=>(0,m.Tz)(e.modelId,M??[]))) ... b({models:s,defaultModelId:y?.modelId,currentModelId:o})
function b(...){for(const r of e){const e=r.displayModelId||r.modelId||"",a=r.displayName||r.displayNameShort||"" ...
```

Descriptors:

```
GetUsableModelsRequest|1 custom_model_ids 9*
GetUsableModelsResponse|1 models #0*
ModelDetails|1 model_id 9|3 display_model_id 9|4 display_name 9|5 display_name_short 9|6 aliases 9*|2 thinking_details #0?|7 max_mode 8?|8..10 credentials
AvailableModelsResponse.AvailableModel|... 9 supports_thinking|10 supports_images|14 supports_max_mode|15 context_token_limit|16 context_token_limit_for_max_mode|29 parameter_definitions #2*|30 variants #3*|35 is_hidden|36 legacy_slugs|37 id_aliases ...
```

- Path `/aiserver.v1.AiService/GetUsableModels` (`catalog.ts:7`), and the body `{}` equals `customModelIds: []` when Bedrock is off (`provider.ts:38`). **MATCH.** The extension uses Connect JSON and the CLI uses binary proto. Both are valid Connect unary encodings.
- **Headers.** The CLI's aiserver interceptor `ot(...)` in `index.js` sets them:

  ```js
  const u=(()=>{try{const t=r?.configProvider?.get().privacyCache?.ghostMode;return"boolean"!=typeof t||t}catch{return!0}})()
  i.header.set("x-ghost-mode",u?"true":"false"),(0,_._5)(i.header),(0,_.EL)(i.header,n),   // EL = x-cursor-team-id
  i.header.set("x-cursor-client-version",`cli-2026.11.05-86047df${d}`),i.header.set("x-cursor-client-type",l),
  ...Intl.DateTimeFormat().resolvedOptions().timeZone -> "x-cursor-timezone", ... x-request-id randomUUID
  ```

  The extension sends `x-ghost-mode: false` (`catalog.ts:40`). The CLI sends the cached privacy setting, which defaults to **true**. This user's `~/.cursor/cli-config.json` has `privacyCache.ghostMode: true` and `privacyMode: 2`, so the extension tells the server ghost mode is off for a privacy-mode user. The extension also omits `x-cursor-timezone`, `x-request-id`, and `x-cursor-team-id` (when a team id is present) on this call. **MISMATCH.**
- **List contents.** The CLI shows `displayModelId || modelId` as the id and `displayName || displayNameShort` as the name. It filters by the `modelSelectionRestrictionMessage` allow-list from AvailableModels and drops Bedrock ids unless Bedrock is enabled. The extension uses `modelId` and `displayName` only (`catalog.ts:44-58`). **MISMATCH** (minor; the id the extension registers is the id the CLI sends in Run).
- **Metadata the extension discards** (`catalog.ts:64-77` hard-codes `contextWindow 200_000`, `maxTokens 200_000`, `reasoning: false`, `input: ['text']`): `aliases`, `maxMode`, `thinkingDetails`, and `displayNameShort` from GetUsableModels. The extension never calls AvailableModels, so it also loses `context_token_limit`/`_for_max_mode`, `supports_images`, `supports_thinking`, `supports_max_mode`, `parameter_definitions` (context, effort/reasoning, fast, thinking), `variants`, and `is_hidden`/`legacy_slugs`. Example of the parameters the CLI saved for this user: `claude-opus-5-5 → context=300k, effort=medium, fast=false` and `gpt-5.6-luna → context=272k, reasoning=max, fast=false`. None of these reach Pi.

## 4. AgentService/Run transport and headers

**Host** — CLI (`index.js`, agent transport `mt(...)` plus `"./src/utils/service-urls.ts"`):

```js
const a=e.agentEndpoint??(0,Y.bd)(e.backendUrl,r /*ghostMode*/,e.serverAgentUrlConfig,o /*useHttp1*/);
function l(t,e,r,n){return t.includes("localhost")||...||n?t:r?.agentUrl&&r?.agentnUrl?e?r.agentUrl:r.agentnUrl:t}
```

This user's `serverConfigCache.agentUrlConfig` is `{agentUrl: https://agentn.global.api5.cursor.sh, agentnUrl: same}`, so the CLI posts Run to **agentn.global.api5.cursor.sh** over a pool of 4 HTTP/2 sessions with `pingIntervalMs:1e4`. The extension connects to `https://api2.cursor.sh` (`http2.ts:38-39`, README.md:29). **MISMATCH** in the endpoint. api2 evidently accepts Run, since the extension's live checks used it, but that is not the CLI's routing, and the routing depends on privacy mode.

**Headers** — CLI Run headers come from the same `ot` interceptor plus the per-run headers in `"../agent-client/dist/index.js"`:

```js
const vt={...yt.headers,"x-request-id":g,"x-original-request-id":_ /*runId*/,...l(h) /*parent ids: subagents only*/,...d() /*INFERENCE_PROXY_JWT env only*/};
// yt.headers = (0,j.o)(agentStore, N.headers) from "./src/utils/blob-encryption-key-header.ts":
const n="x-blob-encryption-key";function o(e,t){... o=e.getMetadata("blobEncryptionKey") ... r[n]=o}
// every new agent store gets blobEncryptionKey:x() at creation
// connect-es: content-type application/connect+proto, connect-protocol-version 1, User-Agent "connect-es/1.6.1",
//             sendCompression gzip (connect-content-encoding), connect-accept-encoding gzip
```

| Header | CLI | Extension (`http2.ts:41-54`) | Verdict |
|---|---|---|---|
| content-type, connect-protocol-version, connect-accept-encoding, user-agent | connect-es defaults | same values | MATCH |
| connect-content-encoding | gzip (frames ≥ 1 KiB compressed) | absent, frames uncompressed | MISMATCH (benign) |
| x-cursor-client-type / -version | `cli` / `cli-2026.11.05-86047df` + channel suffix | same, pinned constant (`wire.ts:6` and `catalog.ts:8`, duplicated) | MATCH now; goes stale when the CLI updates |
| x-ghost-mode | `privacyCache.ghostMode`, default true | hard-coded `true` | MISMATCH (coincides for this user) |
| x-cursor-timezone | `Intl...resolvedOptions().timeZone` | hard-coded `America/Los_Angeles` | MISMATCH (coincides on this PST host) |
| x-request-id | random UUID | random UUID | MATCH |
| x-original-request-id | run id | absent | MISMATCH |
| x-blob-encryption-key | per-conversation key | absent | MISMATCH (privacy-relevant) |
| x-cursor-team-id | when `authInfo.teamId` is set | absent | MISMATCH (team accounts only) |

## 5. Run message encoding

Descriptors (from the bundle):

```
AgentClientMessage|1 run_request|2 exec_client_message|5 exec_client_control_message|3 kv_client_message|4 conversation_action|6 interaction_response|7 client_heartbeat|8 prewarm_request
AgentRunRequest|1 conversation_state|2 action|3 model_details|9 requested_model|...|5 conversation_id 9?|...|8 custom_system_prompt 9?|12 exclude_workspace_context 8?|...|25 run_id 9?|29 system_prompt_spec
ConversationAction|1 user_message_action|...
UserMessageAction|1 user_message|2 request_context|...|7 conversation_history #3?
UserMessage|1 text 9|2 message_id 9|3 selected_context #0?|4 mode #1 (AgentMode)|...
RequestedModel|1 model_id 9|2 max_mode 8|3 parameters #0*|...      RequestedModel.ModelParameterValue|1 id 9|2 value 9
AgentMode: [0 UNSPECIFIED][1 AGENT][2 ASK][3 PLAN][4 DEBUG][5 TRIAGE][7 MULTITASK][8 CUSTOM]
```

Extension `encodeRunFrame` (`wire.ts:52-64`):

| Extension bytes | Descriptor name | Verdict |
|---|---|---|
| top field 1 | `AgentClientMessage.run_request` | MATCH |
| run.1 = empty | `conversation_state` (empty ConversationStateStructure) | MATCH for a new conversation |
| run.2 → 1 → 1 | `action.user_message_action.user_message` | MATCH |
| user.1 text, .2 message id | `text`, `message_id` | MATCH |
| user.3 = empty | `selected_context` (empty SelectedContext) | MATCH (the CLI fills images, skills, and commands) |
| user.4 = 2 | `mode` = `ASK` | MATCH |
| run.5 | `conversation_id` | MATCH (number and type) |
| run.9 | `requested_model`; `.1 model_id`, `.3 parameters{id:"fast",value:"false"}` | numbers MATCH, **values MISMATCH** (see below) |
| run.12 = 0 | `exclude_workspace_context` (optional bool, explicit false) | MATCH on the wire. Semantically it contradicts the empty RequestContext; the honest value is `true` |
| run.25 | `run_id` | MATCH |
| — | `model_details` (3) | CLI omits it when requested_model is set (`"./src/model-request-format.ts"`: `void 0!==e.requestedModel?{modelDetails:void 0,...}`). MATCH |

`--mode ask` → `"search"` → `AgentMode.ASK`:

```js
h=(e,t)=>{switch(e){case"plan":return"plan";case"chat":case"ask":case"search":return"search"; ...
p=e=>{switch(e){case"plan":return s.xyI.PLAN;case"search":return s.xyI.ASK; ...
```

RequestedModel — CLI `buildRequestedModel()`:

```js
new a.G4({modelId:e.modelId,maxMode:!this.hasFixedNonMaxModelCatalog()&&(this.getCurrentModel()?.maxMode??!1),
          parameters:e.parameters.map(...)})
getParametersForModel(e,t){... saved config modelParameters[e] ?? variants.find(isDefaultNonMaxConfig) ?? ...}
```

The extension sends `fast=false` for every model (`wire.ts:54`). The CLI sends each model's saved or default-variant parameters. For a parameterized model, the extension omits `context`, `effort`/`reasoning`, and `thinking`, and it sends `fast` to models that may not define it. **MISMATCH.** The likely effect is that the server picks defaults, so effort and context can differ from what the CLI would use for the same model id.

## 6. Server message decoding and client obligations

Descriptors:

```
AgentServerMessage|1 interaction_update|2 exec_server_message|5 exec_server_control_message|3 conversation_checkpoint_update|4 kv_server_message|7 interaction_query|8 ttft_breakdown
InteractionUpdate|1 text_delta|7 partial_tool_call|15 tool_call_delta|2 tool_call_started|3 tool_call_completed|4 thinking_delta|5 thinking_completed|6 user_message_appended|8 token_delta|...|13 heartbeat|14 turn_ended|...|31 model_call_completed
TextDeltaUpdate|1 text 9|2 is_server_notice 8      ThinkingDeltaUpdate|1 text 9|2 thinking_style
TurnEndedUpdate|1 input_tokens 3?|2 output_tokens 3?|3 cache_read_tokens 3?|4 cache_write_tokens 3?|5 reasoning_tokens 3?|6 ended_at_ms|7 estimated_cost
ExecServerMessage|1 id 13|15 exec_id 9|2 shell_args|3 write_args|4 delete_args|5 grep_args|7 read_args|8 ls_args|9 diagnostics_args|10 request_context_args|11 mcp_args|20 fetch_args|...|44 git_diff_request
ExecClientMessage|1 id 13|15 exec_id 9|...|10 request_context_result
ExecClientControlMessage|1 stream_close{1 id}|2 throw|3 heartbeat{1 id}
RequestContextResult|1 success|2 error|3 rejected      RequestContextSuccess|1 request_context|2 served_from_disk_cache
```

- **Text and turn end** (`wire.ts:188-194`): `1.1.1` = `interaction_update.text_delta.text`, and `1.14` = `turn_ended`. **MATCH.** Print mode also concatenates server-notice deltas (`case"textDelta":...K+=n.message.value.text`), so ignoring `is_server_notice` matches. Thinking (field 4) is dropped by both in plain JSON output. **MATCH.**
- **request_context reply** (`wire.ts:66-70`, `turn.ts:56-58`): the extension echoes `ExecServerMessage.id` (field 1) and replies with `exec_client_message{id, request_context_result.success.request_context{}}`. The CLI serializer is `new k.yT({id:e,message:{case:t,value:r}})`, which also omits `exec_id`. Encoding **MATCH**. The CLI then writes `exec_client_control_message.stream_close{id}`; the extension does not. **MISMATCH.**
- **Content of the reply:** the CLI's request-context executor fills `RequestContext.env` (`RequestContextEnv`: os_version, workspace_paths, shell, time_zone, project_folder, sandbox flags, ...), `rules`, `repository_info`, `git_repos`, `tools` (MCP), `agent_skills`, `custom_subagents`, `hooks_config`, and more. The extension sends an empty `RequestContext`. **MISMATCH.** It is probably the intended behaviour for a "Pi conversation only" ask, but then `exclude_workspace_context=true` is the matching signal. Note that it also leaves the model without a time zone or OS.
- **Other exec requests.** The CLI dispatcher replies to every exec. When no handler exists, it sends `throw` + `stream_close`:

  ```js
  for await(const t of o)await a.write(t);await a.write(new k.$Y({message:{case:"streamClose",value:new k.D9({id:e.id})}}))
  ... `No handler found for server message of type ${i}` ... yield {case:"throw"...}; yield {case:"streamClose"...}
  ```

  The CLI help says `ask: Q&A style for explanations and questions (read-only)`, so ask mode can still issue read, ls, grep, and similar exec calls. The extension's `decodeFrame` only recognises field 10 (`wire.ts:181-187`) and silently drops everything else. When the server waits on a read, grep, or ls result, KV `get_blob`/`set_blob` (the CLI answers with `getBlobResult`/`setBlobResult`), or an `interaction_query` (web search or fetch approval), the extension never answers. The turn then stalls until `turn.ts` throws `Cursor ask timed out.` at 120 s. **MISMATCH (high).** README.md:37's "Ask mode does not run tools" contradicts the CLI's own help text.
- **Heartbeats.** The CLI's client heartbeat:

  ```js
  const Ft=5e3; ... ct.write(new A.KS({message:{case:"clientHeartbeat",value:new A.kA}})) ... every 5 s
  // exec heartbeat while an exec runs: a.write({case:"heartbeat",value:{id}}) every 3e3 ms
  // HTTP/2: new B.gE(a,{pingIntervalMs:1e4,pingTimeoutMs:2e4,pingIdleConnection:!0},t)
  ```

  The extension sends no heartbeat (AgentClientMessage field 7) and no HTTP/2 pings. **MISMATCH.** The impact is unknown; it risks server-side idle cancellation on long thinking turns.
- **Deadline.** `turn.ts:9` calls `FIRST_BYTE_MS = 120_000`, but `turn.ts:42` measures from `started`, so the limit applies to the whole turn. The CLI has no total turn limit. A long answer fails in Pi where it succeeds in the CLI.

## 7. Multi-turn, system prompt, and images

**CLI:**
- The CLI continues a conversation with the same `conversation_id`, a non-empty `conversation_state` (ConversationStateStructure: turns and root prompt as blob ids, token details, mode, ...), and client-side blobs served over KV. `--resume [chatId]` and `--continue` reload that state from `~/.cursor/chats/<hash>/<id>/`.
- Headless mode also offers `--conversation-history-file <file>`, which imports prior turns as structured `UserMessageAction.conversation_history` (field 7):

  ```
  ConversationHistory|1 messages*|2 replace_user_info
  ConversationHistoryMessage|1 user|2 assistant|3 tool
  ConversationHistoryUserContent|1 text|2 image      ConversationHistoryAssistantContent|1 text|2 reasoning|3 redacted_reasoning|4 tool_call
  ConversationHistoryToolMessage|1 tool_call_id|2 tool_name|3 content*|4 is_error
  ```

  ```js
  u=new c.UserMessageAction({conversationHistory:N.conversationHistory,userMessage:new c.UserMessage({text:t,selectedContext:d,messageId:crypto.randomUUID(),mode:...})})
  ```

- System prompt: `AgentRunRequest.custom_system_prompt` (8) and `system_prompt_spec{replace|append}` (29) exist. `--system-prompt <file>` is "Anysphere/OpenAI team only".
- Images: `--image <path>` → `SelectedContext.selected_images`, and history supports `ConversationHistoryImageContent`.

**Extension:** `promptFrom` (`stream.ts:46-51`) joins the text of every Pi message (user, assistant, and thinking) with blank lines. It has no role markers, and assistant text reads as user text. It sends that as one `UserMessage` under a fresh random `conversation_id` (`wire.ts:58`) with empty state. `context.systemPrompt` is never read. Image parts are dropped (`stream.ts:33-44`), and the error at `stream.ts:156` fires only when nothing is left. The fallback passes the whole transcript as one argv entry (`stream.ts:30`), which hits ARG_MAX on long sessions. **MISMATCH.** The bundle shows a protocol-native fix: map Pi messages to `conversation_history`.

## 8. Errors

**CLI** (`"../agent-client/dist/index.js"`, `it(...)` classifier):

```js
const H=new Set([NOT_LOGGED_IN,AGENT_REQUIRES_LOGIN,AUTH_TOKEN_NOT_FOUND,AUTH_TOKEN_EXPIRED,INVALID_AUTH_ID,UNAUTHORIZED,...]) -> ActionRequired "login"
z=new Set([FREE_USER_USAGE_LIMIT,FREE_USER_RATE_LIMIT_EXCEEDED,PRO_USER_ONLY,PRO_USER_USAGE_LIMIT,PRO_USER_RATE_LIMIT_EXCEEDED,RATE_LIMITED,RATE_LIMITED_CHANGEABLE,GENERIC_RATE_LIMIT_EXCEEDED]) -> "upgrade"
W=USAGE_PRICING_REQUIRED* -> "payment";  K=BAD_API_KEY,BAD_USER_API_KEY,OUTDATED_CLIENT -> "config"
// details come from t.findDetails(ErrorDetails) (binary aiserver.v1.ErrorDetails{error enum, details: CustomErrorDetails{title,detail,isRetryable,...}})
if(n===Code.Unauthenticated)return new L(t.message,"login",...)
// retriable errors and transport errors (NGHTTP2, ECONNRESET, ...) retry with backoff; rate limits wait retryAfterMs
// auth-errors.ts: on Unauthenticated from model list -> clearAuthentication(), "Your stored authentication is invalid. Please log in again."
```

**Extension:**
- `decodeFrame` (`wire.ts:167-177`) maps an end-stream error to the login message only if the string `ERROR_NOT_LOGGED_IN` appears somewhere in the JSON `details`. That string is present only in Connect's optional `debug` field; the authoritative `value` is base64 proto and is never decoded. Otherwise the extension surfaces `error.message`.
- HTTP status mapping (`http2.ts:12`): 401/403 → re-login, and 429 → "usage or credits are exhausted". A Connect stream returns HTTP 200 and carries errors in the end-stream frame. connect-es maps HTTP 429 to `Unavailable` (retriable), not to a usage limit.
- No retry. The `CustomErrorDetails.title`/`detail` text, which is what the CLI shows, is never displayed.

**MISMATCH.**

## 9. Usage and token reporting

The server sends `TurnEndedUpdate{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens}` on field 14. With `emit_model_call_usage` it also sends `ModelCallCompletedUpdate`. Print mode converts them:

```js
case"turnEnded":{const e=n.message.value; ... ce=$({inputTokens:Number(e.inputTokens??0n),outputTokens:...,cacheReadTokens:...,cacheWriteTokens:...,reasoningTokens:...})}
function $(e){return{...e,inputTokens:Math.max(e.inputTokens-e.cacheReadTokens-e.cacheWriteTokens,0)}}
```

The extension's native path recognises field 14 only as a turn end (`wire.ts:190`) and publishes `ZERO_USAGE` (`stream.ts:163`). **MISMATCH.** The fix is small: parse varints 1-4 of the turn_ended payload.

## 10. `--print --output-format json` result

```js
const e={type:"result",subtype:"success",is_error:!1,duration_ms:te,duration_api_ms:te,result:K||"",
         session_id:N.sessionId,request_id:ee,...ce?{usage:ce}:{}};   // usage keys: inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens?
```

`subtype:"success"` is the only result subtype in the bundle (`rg 'type:"result",subtype:"[a-z_]+"'` gives 3 hits, all `success`). Failures exit non-zero and write to stderr. The extension reads `type`, `subtype`, `is_error`, `result`, and `usage.{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}` (`stream.ts:61-95`) and prefers stderr on a non-zero exit (`stream.ts:115-122`). **MATCH.** `inputTokens` is already net of cache, so `totalTokens` (`stream.ts:68`) is not double-counted. `reasoningTokens` is ignored.

## Top mismatches ranked by user impact

1. **Unanswered exec, KV, and interaction-query requests, plus a 120 s total deadline** (row 6b and the deadline): ask mode is read-only, not tool-free. Any turn where the model reads, greps, or asks for web approval stalls and then fails with "Cursor ask timed out." Long answers fail at 120 s even when they are streaming.
2. **Flattened transcript with a fresh conversation every turn, and no system prompt** (row 7): multi-turn context loses roles, and Pi's system prompt is dropped. The CLI already exposes structured `conversation_history` on the same RPC.
3. **Ghost-mode header and routing** (rows 3b, 4a, 4b): GetUsableModels tells Cursor that ghost mode is **off** for a privacy-mode user. Run goes to api2 instead of the server-configured agent host and omits `x-blob-encryption-key`. Privacy semantics differ from the CLI.
4. **Model parameters and metadata** (rows 3c, 5b): every model gets `fast=false` only, with no context, effort, or thinking parameters. Pi sees a fixed 200k window, no reasoning, and text-only input regardless of the real model.
5. **Zero usage on the native path** (row 9): token accounting is always 0 even though the server sends it.
6. **Error mapping** (row 8): the extension does not decode binary ErrorDetails, mislabels HTTP 429, and never retries. Rate-limit and usage-limit errors surface as raw messages, or as a login prompt only when the debug JSON happens to be present.
7. **No heartbeats or stream_close** (row 6c): the risk of idle cancellation on long turns is unverified.
8. **macOS-only credentials, and no `CURSOR_API_KEY` fallback** (row 1b/1d).
9. **Hard-coded timezone and a client version that will go stale** (row 4b): correct only on a PST host running this exact CLI build.

## Gaps in this slice

- Static only. Whether api2 and the agentn host behave differently, whether the server actually blocks on KV `set_blob`, and whether missing heartbeats cancel a turn all need a live capture (another slice).
- Descriptor `#N` references were resolved by message name, not by following the minified class array. The names match the extension's nesting at every level checked.
