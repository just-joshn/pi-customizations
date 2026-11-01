# Delta. Claude Code 2.1.316 vs 2.1.312 OAuth

Left. 2.1.312 sha256 `6b5ec691195e551b02c41df9f7d723f4ea61eaa03c2df90acefe3736f1aeb620` (prior ledger under `../claude/`).
Right. 2.1.316 sha256 `64c327e92b2c5e0f78c0a980c5a518121e1f0d140ca771ca5dd4488d1a2dcb3f` (this directory). Both re-measured for this table; 312 config block compared by reading both binaries.

## Changed

| Item | 2.1.312 | 2.1.316 | Evidence |
| --- | --- | --- | --- |
| Binary sha256 | `6b5ec691…aeb620` | `64c327e9…2dcb3f` | `shasum -a 256` |
| Size | 275988512 | 310114176 | `stat` |
| Mach-O UUID | `4C4C44F7-5555-3144-A118-0ED0722B1D91` | `4C4C448E-5555-3144-A1C7-456A93B4DC4F` | REA `inspect_macho` |
| VERSION / UA / billing digits | `2.1.312` | `2.1.316` | bunfs PACKAGE metadata + `lrs` / UA templates |
| BUILD_TIME | (prior build) | `2026-10-30T23:28:13Z` | bunfs metadata object |
| GIT_SHA | (prior) | `cd7ceb459c6864567b16a11f60101b24421475c1` | bunfs metadata object |
| Bunfs offsets | e.g. config `217350283` | config `251220243` (also low copy ~`125777944`) | `string-offsets.json` |
| Minified names | `gto`/`Zxt`/`Y9r`/`AA`/`q9r`/`P5e`/`getOauthConfig` | `hco`/`m0t`/`Vto`/`gR`/`zto`/`_Ye`/`nn` | carves |
| FE / login helper names | `FE`/`ck`/`Nqt` | wrapper around `Uk`/`N8t` (same latch semantics) | `tight-FE_revoked@254728815.txt` |

## Unchanged (re-confirmed on 2.1.316)

| Item | Confirmation |
| --- | --- |
| Prod `var a={…}` oauth config object | Identical sha256 prefix `f660a55ce5bcf589` across both binaries |
| Authorize hosts (cai + console) | Same URLs |
| Client ids (prod/design/local) | Same UUIDs |
| Manual + loopback redirect forms | Same |
| Login seven-scope list incl. plugins | Same (`hco` = org + `m0t`) |
| Refresh scopes omit `org:create_api_key` | Same (`m0t`) |
| PKCE S256 + independent state | Same `b`/`L`/`O`/`y` |
| Token URL + JSON grants + 30s | Same |
| Revoke path `${TOKEN_URL}/revoke` + 5s | Same |
| Exchange 401 error string | Same |
| Paste `H()` grammar + messages | Same |
| `ALLOWED_OAUTH_BASE_URLS` three hosts + miss error | Same (`_Ye`) |
| `oauth-2025-04-20` beta | Same |
| Billing salt `59cf53e54c78` + indices `[4,7,20]` | Same |
| Fingerprint sample filter `user && !isMeta` | Same on both (312 already lacked `isCompactSummary` in `dH`/`nF`) |
| Ambient. AUTH_TOKEN before CLAUDE_CODE_OAUTH_TOKEN; no `ANTHROPIC_OAUTH_TOKEN` | Same (count 0 both) |
| `claudeAiOauth` field set + keychain service shape | Same |
| 5-minute proactive refresh (`n+300000>=e`) | Same |
| `oauthRefreshLatch.attempted` + FE 401/403-revoked retry | Same semantics |
| Messages `x-app` dynamic `?*"cli-bg":"cli"` | Present in both (312 `Ft()`, 316 `$t()`); prior 312 fixture under-documented the dynamic site |
| Static `"x-app":"cli"` secondary site | Present in both |

## Not a protocol delta

Minified identifier renames and bunfs layout shifts do not change Anthropic-visible request shape. Version digit changes do change UA and `cc_version` fingerprint input.
