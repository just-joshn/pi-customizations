# Claude Code 2.1.312 OAuth protocol

Measured from offline bunfs carves of `/Users/josh-desktop/.local/share/claude/versions/2.1.312` (sha256 `6b5ec691195e551b02c41df9f7d723f4ea61eaa03c2df90acefe3736f1aeb620`), REA `open_binary` / `inspect_macho` / carved-module `analyze_javascript_application`, and `login-probe.txt`. No live token exchange was completed.

REA Evidence (session receipts). `open_binary` sha256 match. `inspect_artifact` parent `ev_22c9cd75ed32b5c0b17273c9cd8cb869e1af5da2844c6b42639e27a99275faef` (root Mach-O only; SEA not unpacked by `extract_artifact`). `inspect_macho` parent `ev_a0dbfded35ee358702abf318c766830ab52646626260ef56f4a2422fb4e81a59` (arm64, uuid `4C4C44F7-5555-3144-A118-0ED0722B1D91`). Carved JS summary parent `ev_06a800b189d56b1b0f44ad163095500cc968f12b88a268c4cae061317b08878a` (directory digest `0897055e04687c0e8a1d7b76b70a2f0307ecc65a3372f17c2b65e9b312a4b554`). Bun SEA JS lives under `/$bunfs/root/`; REA cannot extract Mach-O SEA, so modules were carved offline into `extracted-js/`.

## Authorize URL

**Claude.ai subscription login** uses `https://claude.com/cai/oauth/authorize` (`CLAUDE_AI_AUTHORIZE_URL`).

**Console login** uses `https://platform.claude.com/oauth/authorize` (`CONSOLE_AUTHORIZE_URL`).

Evidence. bunfs config object at file offset `217350283` (`carves/tight-TOKEN_CONFIG@217350283.txt`, window sha256 `4fee18256b02f580…`). Login probe printed the cai URL. Builder `Y9r` at `220544799` picks cai when `loginWithClaudeAi` is true (`carves/tight-Y9r_full@220544799.txt`).

## Query params (append order)

`Y9r` appends params in this order via `URLSearchParams.append`:

1. `code` = `true`
2. `client_id`
3. `response_type` = `code`
4. `redirect_uri`
5. `scope` (space-joined)
6. `code_challenge`
7. `code_challenge_method` = `S256`
8. `state`
9. optional `orgUUID`
10. optional `login_hint`
11. optional `login_method`

Evidence. `Y9r` body at `220545000`. Optional appends at `220545511` / `220545551` / `220545594`. Login probe order matches items 1 through 8. Fixture `fixtures/authorize-url-2.1.312.json`.

## Client id

Prod client id. `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (`CLIENT_ID`).

Design client id (separate). `59637612-477b-4836-a601-b0589eda7704` (`DESIGN_CLIENT_ID`). Not used by the standard cai login path.

Local oauth override uses client id `22422756-60c9-4084-8eb7-27705fd5cf9a`. Custom URL path can override via `CLAUDE_CODE_OAUTH_CLIENT_ID` (forces plugins/projects/hybrid scope flags off).

Evidence. config at `217350283`. Probe carries the prod id.

## Scopes

Login scope list from `gto()` (unique of `n` then `Zxt()`):

1. `org:create_api_key`
2. `user:profile`
3. `user:inference`
4. `user:sessions:claude_code`
5. `user:mcp_servers`
6. `user:file_upload`
7. `user:plugins` (when `PLUGINS_SCOPE_REGISTERED`, true in prod)

`Zxt()` alone (refresh default / `claudeAiLoginScopes` export) omits `org:create_api_key`.

Inference-only login can request only `user:inference` (`xk`).

`hls` / `firstPartyRefreshScopes` = unique(`Zxt()` + preservable project scopes from prior token).

Evidence. scope helpers at `217349591` (`carves/tight-bu_beta_scopes@217349591.txt`). Probe scope string matches the seven-scope list.

## Redirect URIs

**Copy-code / manual.** `https://platform.claude.com/oauth/code/callback` (`MANUAL_REDIRECT_URL`).

**Loopback.** `http://localhost:${port}/callback` where `port` comes from the local listener.

The login class always builds the manual URL (`isManual: true`). If the listener binds, it also builds the loopback URL and may open that in the browser. Exchange uses `useManualRedirect: !automatic` where automatic means the listener received the code.

Evidence. `Y9r` / `tXo` at `220545000`. `o$` login class at `221658382`. Probe printed the manual redirect.

## PKCE

Library. Node `crypto` inside the bun SEA (`import{createHash as T,randomBytes as E}from"crypto"` at `221657206`).

Helpers in the login module:

- `b(buf)`. `buf.toString("base64")` then `replaceAll("+","-")`, `replaceAll("/","_")`, `replaceAll("=","")`.
- Verifier `L()`. `b(E(32))`.
- Challenge `O(verifier)`. `b(sha256(verifier))`.
- Method. `S256`.

State is **not** PKCE. `y()` is a second `b(E(32))`.

Evidence. `carves/tight-pkce_helpers@221657206.txt` (window sha256 `a66617dbc8156086…`). Fixture `fixtures/pkce-2.1.312.json`. Module carve `extracted-js/chunk-oauth-login-pkce.js` sha256 `586516f2081cb38f1c220d2976bdbb191771a0ca53b551622e54bd2331658634`.

## State and paste parser

State is a **second** `randomBytes(32)` base64url value (`y()`). Callback / paste must match that state. Exchange posts the same `state` with the code.

Manual paste path `H()` (TTY readline):

1. `trim` the line.
2. `split("#")` into `[code, state]`.
3. Reject if either half missing (`Invalid code. Please make sure the full code was copied.`).
4. Reject if `state !== expectedState` (`That code is not from this sign-in…`).
5. Deliver `{authorizationCode, state}`.

`H()` does **not** accept raw code-only, query strings, or redirect URLs. The automatic listener path is separate (`waitForAuthorizationCode` / `authCodeListener`).

Evidence. `carves/tight-paste-H-fn.txt`. Fixture `fixtures/paste-code-parser-2.1.312.json`.

## Token URL

`https://platform.claude.com/v1/oauth/token` (`TOKEN_URL`).

POST JSON. `Content-Type: application/json`. Timeout 30000 ms.

Revoke. `POST ${TOKEN_URL}/revoke` with `token`, `token_type_hint` (default `refresh_token`), `client_id`, timeout 5000 ms (`X9r` near `220548305`).

Evidence. config `217350283`. `tXo` / `eie` at `220545650`. Fixture `fixtures/token-endpoints-2.1.312.json`.

## Authorization code grant

Body fields:

- `grant_type`: `authorization_code`
- `code`
- `redirect_uri` (manual or loopback matching the authorize URL used)
- `client_id`
- `code_verifier`
- `state`
- optional `expires_in`

401 maps to `Authentication failed: Invalid authorization code` (metric `oauth_exchange_invalid_code`). Other non-200: `Token exchange failed (${status}): ${statusText}`.

Evidence. `tXo` at `220545746`. `carves/tight-Invalid_authorization_code@220546212.txt`.

## Refresh grant

Body fields:

- `grant_type`: `refresh_token`
- `refresh_token`
- `client_id`
- `scope` (space-joined; default `Zxt()`, not full `gto()`)
- optional `expires_in`

Response handling stores:

- `access` expiry as `Date.now() + expires_in * 1000` (no store-time skew)
- optional refresh expiry via `q9r(refresh_token_expires_in, false)` as `refreshTokenExpiresAt`
- rotates `refresh_token` when returned, else keeps the old one
- merges into `claudeAiOauth` via `TA(..., "refresh")`

Evidence. `eie` at `220546563`. `TA` at `220790005`. Fixture `fixtures/refresh-lifecycle-2.1.312.json`.

## Expiry skew

Proactive refresh predicate `AA(expiresAt)`:

`Date.now() + 300000 >= expiresAt` (5 minutes).

Null `expiresAt` is treated as not expired for this check.

Evidence. `AA` at `220551392` (`carves/tight-AA_body@220551392.txt`).

## ALLOWED_OAUTH_BASE_URLS

Export alias `P5e as ALLOWED_OAUTH_BASE_URLS` from `/$bunfs/root/chunk-7rmk5fgf.js`.

Membership (custom `CLAUDE_CODE_CUSTOM_OAUTH_URL` allowlist only; **not** prod authorize hosts):

1. `https://beacon.claude-ai.staging.ant.dev`
2. `https://claude.fedstart.com`
3. `https://claude-staging.fedstart.com`

Miss throws `CLAUDE_CODE_CUSTOM_OAUTH_URL is not an approved endpoint.`

Evidence. `P5e` at `217352359` (`carves/tight-P5e-ALLOWED@217352359.txt`). Export table at `244131473`. Fixture `fixtures/allowed-oauth-bases-2.1.312.json`.

## Related oauth HTTP (not the token URL)

Also present in prod config / helpers:

- Profile. `${BASE_API_URL}/api/oauth/profile` with Bearer
- Validate. `${BASE_API_URL}/api/oauth/validate` with Bearer
- Create API key. `https://api.anthropic.com/api/oauth/claude_cli/create_api_key`
- Roles. `https://api.anthropic.com/api/oauth/claude_cli/roles`
- Revoke. `${TOKEN_URL}/revoke`
- Client metadata URL string. `https://claude.ai/oauth/claude-code-client-metadata`

Evidence. config and profile helpers around `217350283` / `220541816`. Fixture `fixtures/oauth-config-2.1.312.json`.

## Residual unknowns

- Live Anthropic acceptance of refresh `scope` without `org:create_api_key` (policy blocked live exchange). Local stub path exists in extension tests.
- Whether non-TTY paste fallbacks accept forms beyond `H()` (TTY path recovered completely).
- Windows Credential Manager / Linux secret-service backends beyond plaintext `.credentials.json` (macOS keychain + plaintext recovered).
