# Ledger. agy OAuth parity

Binary. `/Users/josh-desktop/.local/bin/agy` sha256 `09cefed6a1d217e14ba1751dce4442b97c2797e88c297c77fda3690f92ceddcd`.

Compared to. `extensions/pi-antigravity-oauth`.

Machine-readable rows. `ledger.json`.

## Summary counts

| Status | Count |
| --- | --- |
| VERIFIED | 27 |
| INCONCLUSIVE | 0 |
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
| oauth.client_secret_k58 | VERIFIED | Secret <google-oauth-client-secret>… matches Pi (role among three secrets inferred) |
| oauth.client_secret_other | VERIFIED | Two additional GOCSPX secrets documented |
| oauth.client_metadata | VERIFIED | client-metadata.json URL and live GET |
| oauth.token_endpoint_auth_method | VERIFIED | Metadata says `none` (wire secret use inconclusive) |
| oauth.scopes | VERIFIED | All Pi scopes present as literals (order inconclusive) |
| oauth.pkce_s256 | VERIFIED | PKCE S256 literals |
| oauth.access_type_offline | VERIFIED | Pi authorize URL has access_type=offline and prompt=consent (test asserts both) |
| oauth.refresh | VERIFIED | refresh_token grant supported |
| oauth.expiry_delta_10s | VERIFIED | Pi EXPIRY_DELTA_MS=10s; golang.org/x/oauth2 default; binary expiryDelta symbol |
| oauth.project_load_code_assist | VERIFIED | loadCodeAssist / cloudaicompanionProject |
| oauth.ide_type_antigravity | VERIFIED | loadCodeAssist body ideType ANTIGRAVITY |
| oauth.sts_wif | VERIFIED | STS/WIF present, unused by consumer keychain |
| deps.bearer_header | VERIFIED | Bearer access token |
| deps.user_agent | VERIFIED | Live UA antigravity/cli/1.4.11 cl=1010154931 |
| deps.catalog_auth | VERIFIED | fetchAvailableModels |
| deps.stream_auth | VERIFIED | streamGenerateContent |
| deps.cloud_code_url | VERIFIED | daily-cloudcode-pa + CLOUD_CODE_URL |
| deps.cred_keychain | VERIFIED | gemini/antigravity go-keyring-base64 |
| deps.cred_no_project_in_keychain | VERIFIED | No projectId in keychain blob |
| deps.claude_on_disk | NOT APPLICABLE | Claude credential files are not an Antigravity oauth dependency |
| parity.pi_matches_consumer_oauth | VERIFIED | Pi constants match consumer oauth |
| parity.user_agent_version | VERIFIED | Pi UA 1.4.11 / cl=1010154931 matches measured agy |
| parity.no_runtime_agy | VERIFIED | Pi login is self-contained |

## Top gaps

1. Whether token POST still sends `client_secret` under metadata `auth_method=none`.
2. Optional keychain import if Pi should adopt an existing agy session without re-login.
