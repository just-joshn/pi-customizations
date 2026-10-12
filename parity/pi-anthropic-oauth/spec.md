# pi-anthropic-oauth behavioral specification

## Sources
- S1: Installed Claude Code 2.1.296 published CLI interface; sanitized help/version fixtures. Permitted public interface.
- S2: Authorized black-box synthetic SDK request captured under localhost-only macOS sandbox; `fixtures/claude-current-capture.json`. No proprietary implementation inspected in this audit.
- S3: Existing target implementation/tests and historical 2.1.288 fixture, MIT repository. Historical prose explicitly attributes some facts to binary inspection; those statements are not independently clean-room-confirmed current source facts.
- S4: Installed Pi 1.1.0 bundled docs and exported declarations. Public native API authority.
- S5: `source-grounding.md`, native audit, runtime verification, identity-update reports and their actual command receipts.

## Scope
In scope: subscription authentication, ambient token input, request identity/cache adaptation, refresh/persistence/cancellation, native stream/tool integration, context behavior, compaction, virtual routes, lifecycle and packaging. Out of scope: reconstructing Claude Code's agent/UI/plugins/MCP/telemetry, importing proprietary internals, global installations, account mutation or live inference without authorization.

Source dependencies are replaced semantically: OAuth/browser/PKCE/token transactions → native Pi Anthropic OAuth; credentials → native Pi auth store; transport/SSE/tools/usage → native Anthropic provider; sessions/branches/reload/compaction → Pi; static catalog → Pi catalog (difference, not literal parity). Exact current protocol/account equivalence is not inferred from delegation.

## Requirements
Each `OAUTH-NNN` in `ledger.json` is a requirement; the ledger stores its behavior, mapping, evidence and current status. This specification supplies common trigger, state and scope semantics; acceptance paths live in the ledger and detailed receipts.

| IDs | Trigger / expected behavior | State, failures and ordering | Evidence classification/confidence |
| --- | --- | --- | --- |
| 001–004 | A physical subscription request emits bearer auth, current captured identity and cache controls; boundary prompts retain source-observed attribution | Request-local derivation; explicit header and caller payload hooks stay authoritative; no global env mutation | S2 measured selected baseline high; general fingerprint equivalence unknown |
| 005–008 | `/login` browser or copy-code flow yields valid credentials; expiry refresh rotates atomically | Pi owns callback, state, PKCE, locks and store; abort preserved; no silent account fallback | S1 login URL/scopes/client id measured high; token path and live exchange unknown |
| 009–011 | Resolve a subscription token from native store and the ambient aliases Claude consults; reject API-key input without leakage | Store remains authoritative inside Pi; OAuth failures are locally bounded; signals checked before and after ambient resolution | S1 print-mode precedence measured high; stored-versus-env and Claude error text unknown |
| 012–013 | Model text/images/tool calls/results produce native normalized events and correct usage | No custom transport or execution loop; distinct tool identities must remain callable for full parity | S3 local target contracts high; collision loss measured |
| 014–015 | Compaction/virtual route/reload/fork/replacement still use the receiving physical provider correctly | Pi owns transcript and runtime; stale context must not survive replacement | S4 documented API plus executed S5 integration observations |
| 016–017 | Context-limit handling supports continued work without inventing source parity | Native compaction persists summaries; request-local fitting must not mutate stored history; omitted history is a semantic difference | S3 target tests high; current Claude estimator/threshold semantics unknown |
| 018–020 | Request policy, catalog/entitlements and credential integration match source if claiming complete parity | Do not override Pi-owned agent policy or introduce unauthorized credential access to force equivalence | S2 selected shape measured; S3 deliberate differences documented |
| 021 | Authenticated remote service accepts requests and applies subscription entitlement/billing/cache correctly | Requires authorized credentials and actual account observation | Unknown, local shape tests insufficient |
| 022–023 | Package loads and removes through real Pi; supported OS paths work | Isolated HOME/agent/project only; peer host dependencies; no globals | S4 documented packaging plus actual receipts; only macOS exercised |
| 024 | Surrounding telemetry/plugins/private protocols | Explicitly excluded; no copied/fabricated protocols | Scope decision, not parity credit |
| 025 | Subscription terms permit this client | External legal/account policy; no technical test can establish permission | Unknown; public fetch blocked |

Modes: core provider behavior must load through SDK, print, JSON and RPC. Browser/TUI full login remains unverified unless actually exercised. Platform exercised is macOS, Node 24.21.0, Pi 1.1.0; no extrapolation to Windows/Linux.

## Material unknowns
Token-endpoint path and live code exchange; browser-callback completion; refresh timings; stored-credential versus environment precedence; interactive-mode identity; empty/image fingerprint vectors; current context thresholds; remote entitlement, billing, and cache acceptance; service permission; other OS behavior. Authorization host, scopes, client id, copy-code redirect, and ambient print-mode token selection were measured on Claude Code 2.1.296 and are no longer unknown. Resolve the rest through permitted public documentation and authorized isolated observations, never proprietary binary inspection or fabricated baselines.

## Acceptance boundary
`VERIFIED` rows establish only the named observable/local contract, not the entire OAuth ecosystem. Full parity fails if any in-scope deliberate difference remains. Validator success establishes ledger consistency only. The final verdict must be derived from row statuses and cannot conceal critical unknowns behind passing target tests.
