# Design decisions

## Inputs and scope
Source: installed Claude Code 2.1.296 CLI and permitted black-box observations. Target: existing `extensions/pi-anthropic-oauth`, project-local package on installed Pi 1.1.0. Capability: subscription OAuth authentication plus its request, credential, context, and lifecycle dependencies. Platform exercised: macOS; Node 24.21.0. Other platforms remain unverified. No global install, credentials, publication, or live inference authorized or performed.

The attached implementation workflow permits justified reversible repairs. The user's requested comprehensive parity claim includes authentication and request dependencies, not a recreation of Claude Code's entire agent/UI/plugin system. Deliberate native differences remain differences; they do not count as literal parity.

## Authentication ownership
Options: (A) delegate to native Anthropic OAuth with a bounded confidentiality wrapper and native credential resolution; (B) create a Claude-specific OAuth client, callback server, refresh lock and credential importer.
Choice: A, retained after a clean-room login observation. Installed Pi `docs/providers.md` and `docs/custom-provider.md` support native provider authentication and Pi storage. `pi-ai` `dist/auth/oauth/anthropic.js` hardcodes `https://claude.ai/oauth/authorize`, the shared client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e`, and scopes without `user:plugins`. Claude Code `2.1.296` `auth login --claudeai` printed `https://claude.com/cai/oauth/authorize` and added `user:plugins`. The client id and copy-code redirect `https://platform.claude.com/oauth/code/callback` match. A fake-code exchange returned HTTP 400, but the destination address is shared by several Anthropic hosts, so the token path was not isolated. B would duplicate Pi's PKCE, callback, lock, and store, and could not be live-verified. No second OAuth client is introduced.
Pi owns credential persistence and refresh transactions. Stored credentials still win inside Pi. Ambient subscription selection is extension-owned and now follows the measured Claude print-mode order for the two variables Claude consults.

## Ambient subscription tokens
Options: (A) keep `CLAUDE_CODE_OAUTH_TOKEN`, then `ANTHROPIC_OAUTH_TOKEN`, then `ANTHROPIC_AUTH_TOKEN`; (B) match the measured Claude print-mode order and leave API-key fallback rejected.
Choice: B. Isolated `claude -p` and `claude auth status --json` on `2.1.296` select `ANTHROPIC_AUTH_TOKEN` over `CLAUDE_CODE_OAUTH_TOKEN`, ignore `ANTHROPIC_OAUTH_TOKEN`, and can select `ANTHROPIC_API_KEY` over a setup token. A fails the measured conflict. Copying the API-key win would silently change this subscription provider to API billing, which `references/security.md` forbids. `ANTHROPIC_OAUTH_TOKEN` remains a lower-priority OAuth-shaped alias because Pi documents it; Claude's CLI does not consult it. Stored-versus-environment order was not measured.

## Physical request adjustment
Options: (A) compose native provider `stream`/`streamSimple` options; (B) use ordinary extension request/prompt events or static models.json headers.
Choice: retain A pending actual installed-host probes. B is simpler but cannot derive billing-body content from user text using static headers and existing probes establish compaction/physical virtual-route event gaps. A delegates transport, conversion, cancellation, usage and tools to Pi. No copied transport implementation. The native audit and request-path receipts govern whether this exception remains justified.

## Current request identity
Options: (A) retain stale pinned 2.1.288 identity; (B) refresh pinned identity only using current permitted black-box captures and independent regression vectors.
Choice: B where evidence supports it. Neither design establishes permission or billing acceptance. Running Claude from the extension factory, reading its binary, and importing its internals are rejected. Current version and selected request values are observations; general fingerprint origins and unobserved cases remain explicitly unknown.

## Context management
Options: (A) retain existing request-local fit/calibration adapter and prompt-boundary native compaction; (B) rely exclusively on Pi's compaction/overflow recovery.
Decision pending native audit: the existing synthetic cross-provider overflow reproduction is evidence for a native gap, not evidence that Claude's private thresholds have been reproduced. Pi owns persisted history, branches and summaries; the adapter must never mutate canonical transcripts. Custom request-local omission is a semantic deviation and must be documented, not relabeled full parity. Calibration lifetime, late completion and session replacement require review.

## Verification and distribution
Options: (A) isolated CLI/SDK local peers plus a ledger with external gaps; (B) live credential login/inference or global installation.
Choice: A. It is reproducible, safe and compatible with the authorization boundary. B could establish service acceptance but requires user participation and authorization. Install/remove are exercised only in disposable HOME/agent/project directories. Host packages remain peerDependencies; Pi's actual loader is authoritative.

## Invariants
The extension registers one provider; native Pi owns agent/session/tool/credential lifecycles. Request identity and payload capture are request-local. Abort reasons and Pi's exact `Login cancelled` message must remain cancellation; other login and refresh failures are replaced so token-endpoint bodies do not escape. Caller request hooks retain replacement semantics. No captured fixture contains real tokens or account metadata. Source observations and target correctness tests are different evidence classes. The ledger validator checks consistency, not behavior.
