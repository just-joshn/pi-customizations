# Ledger. agy OAuth parity

Binary. `/Users/josh-desktop/.local/bin/agy` sha256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3` (prior `09cefed6…`).

Go buildinfo. `go1.28-20261025-RC00 cl/1006921819` (REA `inspect_go_binary`).

Compared to. `extensions/pi-antigravity-oauth` (read-only).

Machine-readable rows. `ledger.json`.

## Summary counts

| Status | Count |
| --- | --- |
| VERIFIED | 27 |
| FOLLOW-UP (documented) | 3 |
| NOT APPLICABLE | 1 |
| NOT VERIFIED | 0 |

## Rows

| ID | Status | Requirement |
| --- | --- | --- |
| oauth.auth_url | VERIFIED | Authorization endpoint accounts.google.com/o/oauth2/auth |
| oauth.token_url | VERIFIED | Token endpoint oauth2.googleapis.com/token |
| oauth.userinfo_url | VERIFIED | Email from oauth2/v2/userinfo |
| oauth.redirect | VERIFIED | Redirect https://antigravity.google/oauth-callback |
| oauth.client_id | VERIFIED | Client id 1071006060591-tmhssin2h21lcre235vtolojh4g403ep… |
| oauth.client_secret_k58 | VERIFIED | Secret GOCSPX-K58… matches Pi |
| oauth.client_secret_other | VERIFIED | Two additional GOCSPX secrets documented |
| oauth.client_metadata | VERIFIED | client-metadata.json URL and live GET |
| oauth.token_endpoint_auth_method | VERIFIED | Metadata says `none` (wire secret use is follow-up) |
| oauth.scopes | VERIFIED | All Pi scopes present as literals (order follow-up optional) |
| oauth.pkce_s256 | VERIFIED | PKCE S256 literals |
| oauth.access_type_offline | VERIFIED | Pi authorize URL has access_type=offline and prompt=consent |
| oauth.refresh | VERIFIED | refresh_token grant supported |
| oauth.expiry_delta_10s | VERIFIED | Pi 10s; x/oauth2 expiryDelta symbol |
| oauth.project_load_code_assist | VERIFIED | loadCodeAssist / cloudaicompanionProject |
| oauth.ide_type_antigravity | VERIFIED | loadCodeAssist body ideType ANTIGRAVITY (sink) |
| oauth.sts_wif | VERIFIED | STS/WIF present, unused by consumer keychain |
| deps.bearer_header | VERIFIED | Bearer access token |
| deps.user_agent | VERIFIED | Live UA antigravity/cli/1.4.12 cl=1010700967 |
| deps.catalog_auth | VERIFIED | fetchAvailableModels |
| deps.stream_auth | VERIFIED | streamGenerateContent |
| deps.cloud_code_url | VERIFIED | daily-cloudcode-pa + CLOUD_CODE_URL |
| deps.cred_keychain | VERIFIED | gemini/antigravity go-keyring-base64 |
| deps.cred_no_project_in_keychain | VERIFIED | No projectId in keychain blob |
| deps.claude_on_disk | NOT APPLICABLE | Claude credential files are not an Antigravity oauth dependency |
| parity.pi_matches_consumer_oauth | VERIFIED | Pi constants match consumer oauth |
| parity.user_agent_version | VERIFIED | Pi UA 1.4.12 / cl=1010700967 matches measured agy |
| parity.no_runtime_agy | VERIFIED | Pi login is self-contained |

## Documented follow-ups (not blockers for VERIFIED rows)

1. Capture whether token POST still sends `client_secret` under metadata `auth_method=none`.
2. Optional keychain import if Pi should adopt an existing agy session without re-login.
3. Optional tokeninfo validation / scope-order decompile / WIF if product requires them.

## Top residual unknowns

- Exact AuthCodeURL builder (REA string index times out on ~197MB Mach-O; byte scan used instead).
- Whether token form includes client_secret on the wire.
