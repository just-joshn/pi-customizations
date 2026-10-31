# Claude Code 2.1.312 OAuth protocol

Measured from offline bunfs carves of `/Users/josh-desktop/.local/share/claude/versions/2.1.312` (sha256 `6b5ec691195e551b02c41df9f7d723f4ea61eaa03c2df90acefe3736f1aeb620`) and `login-probe.txt`. No live token exchange was completed.

## Authorize URL

**Claude.ai subscription login** uses `https://claude.com/cai/oauth/authorize` (`CLAUDE_AI_AUTHORIZE_URL`).

**Console login** uses `https://platform.claude.com/oauth/authorize` (`CONSOLE_AUTHORIZE_URL`).

Evidence. bunfs config object at file offset `217350283`. Login probe printed the cai URL. Builder `Y9r` at `220544799` picks cai when `loginWithClaudeAi` is true.

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

Evidence. `Y9r` body at `220545000`. Login probe order matches items 1 through 8.

## Client id

Prod client id. `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (`CLIENT_ID`).

Design client id (separate). `59637612-477b-4836-a601-b0589eda7704` (`DESIGN_CLIENT_ID`). Not used by the standard cai login path.

Local oauth override uses a different client id. Not the prod path.

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

`Zxt()` alone (refresh default) omits `org:create_api_key`.

Inference-only login can request only `user:inference` (`xk`).

Evidence. scope helpers at `217349591`. Probe scope string matches the seven-scope list.

## Redirect URIs

**Copy-code / manual.** `https://platform.claude.com/oauth/code/callback` (`MANUAL_REDIRECT_URL`).

**Loopback.** `http://localhost:${port}/callback` where `port` comes from the local listener.

The login class always builds the manual URL (`isManual: true`). If the listener binds, it also builds the loopback URL and may open that in the browser. Exchange uses `useManualRedirect: !automatic` where automatic means the listener received the code.

Evidence. `Y9r` / `tXo` at `220545000`. `o$` login class at `221658382`. Probe printed the manual redirect.

## PKCE

- Verifier. `randomBytes(32)` then custom base64url (`+`/`/`/`=` stripped).
- Challenge. `sha256(verifier)` then same base64url.
- Method. `S256`.

Evidence. helpers `L`, `O`, `b` at `221658382`.

## State

State is a **second** `randomBytes(32)` base64url value (`y()`). It is **not** the PKCE verifier.

Callback / paste must match that state. Exchange posts the same `state` with the code.

Evidence. `o$.startOAuthFlow` at `221658382`. Exchange body at `220545746`.

## Token URL

`https://platform.claude.com/v1/oauth/token` (`TOKEN_URL`).

POST JSON. `Content-Type: application/json`. Timeout 30000 ms.

Evidence. config `217350283`. `tXo` / `eie` at `220545650`.

## Authorization code grant

Body fields:

- `grant_type`: `authorization_code`
- `code`
- `redirect_uri` (manual or loopback matching the authorize URL used)
- `client_id`
- `code_verifier`
- `state`
- optional `expires_in`

401 maps to "Authentication failed: Invalid authorization code".

Evidence. `tXo` at `220545746`.

## Refresh grant

Body fields:

- `grant_type`: `refresh_token`
- `refresh_token`
- `client_id`
- `scope` (space-joined; default `Zxt()`, not full `gto()`)
- optional `expires_in`

Response handling stores:

- `access` expiry as `Date.now() + expires_in * 1000` (no store-time skew)
- optional refresh expiry via `q9r(refresh_token_expires_in, false)`
- rotates `refresh_token` when returned, else keeps the old one

Evidence. `eie` at `220546563`.

## Expiry skew

Proactive refresh predicate `AA(expiresAt)`:

`Date.now() + 300000 >= expiresAt` (5 minutes).

Null `expiresAt` is treated as not expired for this check.

Evidence. `AA` at `220551335`. Used from refresh path near `220813447` (`AA(G.expiresAt)`).

## Related oauth HTTP (not the token URL)

Also present in prod config:

- Profile. `${BASE_API_URL}/api/oauth/profile` with Bearer
- Validate. `${BASE_API_URL}/api/oauth/validate` with Bearer
- Create API key. `${BASE_API_URL}/api/oauth/claude_cli/create_api_key`
- Roles. `${BASE_API_URL}/api/oauth/claude_cli/roles`
- Client metadata URL string. `https://claude.ai/oauth/claude-code-client-metadata`

Evidence. config and profile helpers around `217350283` / `220541000`.

## Unknowns

- Exact `ALLOWED_OAUTH_BASE_URLS` membership list (export name at `244131473`; body not fully recovered).
- Whether paste input accepts `code#state`, raw code, or redirect URL forms beyond what `waitForAuthorizationCode` implements (listener path recovered; paste parser body not fully isolated).
- Live server acceptance of refresh `scope` without `org:create_api_key` was not exercised.
