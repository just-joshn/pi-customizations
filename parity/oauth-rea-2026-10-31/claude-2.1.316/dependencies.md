# OAuth dependencies. Claude Code 2.1.316

Every row is **VERIFIED** against bunfs/REA evidence for binary sha256 `64c327e92b2c5e0f78c0a980c5a518121e1f0d140ca771ca5dd4488d1a2dcb3f`, or names a concrete **pi-native UNIT** (no runtime claude dependency).

REA receipts. Mach-O `ev_1780f897cd8420a45521c14364214c664b1392075868f4db73d8dddfac312c36`. Carved JS graph `ev_d7c5e4394f965167dcc5503d39f1995dcec33e7691ae2adb4d26ad9f10cd4195`.

| ID | Dep | Status | Claude fact | Evidence | Pi |
| --- | --- | --- | --- | --- | --- |
| DEP-PKCE-CRYPTO | PKCE lib | VERIFIED | `crypto` `b`/`L`/`O`/`y` @265848989 | `fixtures/pkce-2.1.316.json` | `src/oauth.ts` |
| DEP-AUTHORIZE-VTO | Authorize builder | VERIFIED | `Vto` append order + cai/console | `fixtures/authorize-url-2.1.316.json` | `buildAuthorizeUrl` |
| DEP-SCOPES-HCO-M0T | Scope sets | VERIFIED | `hco` login; `m0t` refresh | config carve | constants in `oauth.ts` |
| DEP-TOKEN-KSS | Auth code POST | VERIFIED | JSON + state + 30s | `fixtures/token-endpoints-2.1.316.json` | `postToken` |
| DEP-TOKEN-XAE | Refresh POST | VERIFIED | refresh + m0t scope + absolute expiry | same | `refresh` |
| DEP-REVOKE-XAN | Revoke POST | VERIFIED | `/revoke` + request-id ack | token fixture | UNIT `oauth-revoke` |
| DEP-EXPIRY-GR | Proactive refresh | VERIFIED | `gR` 5m | refresh-lifecycle fixture | Pi resolver ~5m |
| DEP-STATE-PASTE | Paste parser | VERIFIED | `H()` `code#state` | paste fixture | superset; optional strict UNIT |
| DEP-LOGIN-$B | Login class | VERIFIED | manual+loopback | pkce carve `$B` | loopback VERIFIED |
| DEP-ALLOWED-_Ye | Custom bases | VERIFIED | three URLs | allowed-oauth-bases fixture | UNIT allowlist |
| DEP-UA | User-Agent | VERIFIED | `claude-cli/2.1.316 (external, …)` | identity fixture | UNIT version bump |
| DEP-XAPP-Fl | x-app | VERIFIED | `$t()?cli-bg:cli` | `tight-x_app_cli_bg@256050941.txt` | sdk-cli stays `cli` |
| DEP-BILLING | Fingerprint | VERIFIED | salt/indices/`!isMeta` | identity fixture | UNIT version + sample filter |
| DEP-ENV | Ambient auth | VERIFIED | AUTH_TOKEN > CLAUDE_CODE_OAUTH_TOKEN | ha carve | VERIFIED |
| DEP-STORAGE | Cred paths | VERIFIED | `.credentials.json` mode 384 | credentials fixture | import VERIFIED |
| DEP-KEYCHAIN | macOS keychain | VERIFIED | Claude Code service | credentials fixture | import VERIFIED |
| DEP-LATCH | Refresh latch | VERIFIED | `oauthRefreshLatch` | refresh-lifecycle | VERIFIED |
| DEP-401-FE | 401 recovery | VERIFIED | one forced refresh retry | FE carve | VERIFIED |
| DEP-PROFILE | profile/validate/roles | VERIFIED present | URLs + Bearer | oauth-config fixture | UNIT optional |
