# Subscription sign-in and sign-out

Users connect a Claude subscription to the extension's own provider and can disconnect it without changing Pi's built-in Anthropic provider.

## Sub-features

- `login-picker`: discover the exact subscription OAuth provider in `/login`.
- `login-direct`: start the same flow through `/login anthropic-oauth-v2`.
- `login-complete`: browser authorization persists subscription access in the disposable profile.
- `login-cancel`: cancel without creating credentials.
- `logout`: remove only this provider's disposable login.

## How to get to it (user POV)

- Run `/login`, then choose **Anthropic (Claude subscription, OAuth)**.
- Run `/login anthropic-oauth-v2` directly.
- Run `/logout` and choose this provider after signing in.

## Driving it with verify.py and tmux

Preconditions:

- Start `"$V" run "$E"` through `tmux_run`, record its job/session, and pass doctor.
- Completion needs a consenting user with a Claude subscription and browser access. Do not borrow the parent session's auth.

- **Discover.** Send `/login` with literal `tmux send-keys` and Enter. Capture the picker and its `Anthropic (Claude subscription, OAuth)` label. Filter by that exact text and capture it before Enter.
- **Cancel.** Press Escape before confirming authorization. Capture the restored editor; inspect scratch `agent/auth.json` read-only and require no `anthropic-oauth-v2` credential. Never print the file.
- **Direct entry.** Send `/login anthropic-oauth-v2`. Capture the beginning of the same OAuth flow, then let the user authorize in the browser. Do not automate secret entry.
- **Complete.** After Pi reports success, inspect only the stored provider ID, credential type `oauth`, and expiry metadata. Capture `/claude-usage` returning real plan rows or the explicit no-limits notice rather than login guidance. Metadata alone cannot prove valid access.
- **Logout.** Send `/logout`, filter/select the extension's provider, and confirm. Independently require that credential to be absent. Send `/claude-usage` and require the logged-out guidance again.

## Gotchas

- The baseline cannot prove authorization, refresh, or logout of an authenticated account; missing user consent/subscription is a failed precondition, not a successful login test.
- Browser authorization may expose temporary codes and account identifiers. Redact shared captures, never record tokens or copy auth files to evidence.
- Provider names are deliberately similar to built-in Anthropic. Selecting `anthropic` is not extension proof.
- Tests of refresh require real expiry and server behavior; do not force expiry on the user's active credentials.
- Local cleanup removes this profile's login but does not revoke the upstream grant.
