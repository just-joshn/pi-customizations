# Account command

`/antigravity` shows the signed-in account. It prints the email (from Google userinfo), the project, the subscription tier (from `loadCodeAssist`), and the quota groups (from `retrieveUserQuotaSummary`). In the TUI it is a notification. In print mode it goes to stderr. When the user is not logged in, it says so and makes no call.

## Sub-features

- `account-logged-out`: prints `Google Antigravity is not logged in. Run /login and choose Google Antigravity.` and makes no Cloud Code request.
- `account-summary`: prints `Account: …`, `Project: <projectId>`, `Tier: Standard (standard-tier)`, and `Quota:` with `<group>:` / `<bucket>: <n>% left, resets in <h>h <m>m`. It calls `loadCodeAssist` and `retrieveUserQuotaSummary {"project":<projectId>}` on Cloud Code, and calls userinfo on `www.googleapis.com`.
- `account-quota-error`: when the quota call fails, prints `Quota:` / `unavailable: retrieveUserQuotaSummary failed (500): <message>` and keeps the other lines.
- `account-tui`: the same summary appears as a TUI notification.

## How to get to it (user POV)

- In interactive Pi, type `/antigravity`.
- `pi -p /antigravity`.

## Driving it with control-antigravity-oauth

Preconditions:

- `doctor` passes, including the `tmux` check. The peer returns a Standard tier and one `Claude` → `Daily` bucket at 42% that resets in 90 minutes. Its second quota call returns 500 `verify quota outage`.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-antigravity-oauth/bin/control-antigravity-oauth drive account-command`.
- **Logged out.** The drive runs `pi --offline -p /antigravity` with no credential. The output contains the not-logged-in message, and the peer saw zero requests.
- **Summary.** The drive stores a credential and runs `pi --offline -p /antigravity` again.
  - The output shows `Account: unknown`, the project, `Tier: Standard (standard-tier)`, and `Daily: 42% left, resets in 1h 29m` or `1h 30m`.
  - The peer saw `loadCodeAssist` and `retrieveUserQuotaSummary`.
  - The egress log is exactly `["www.googleapis.com:443"]`, the refused userinfo call.
- **Quota error.** The drive runs `/antigravity` a third time, and the output shows the `unavailable: … (500): verify quota outage` line.
- **TUI.** The drive starts the TUI, types `/antigravity`, and presses Enter. The pane shows `Project: verify-project-account` and `Daily: 42% left` (`tui-antigravity.txt`).
- **Proof.** All cases are in `artifacts/verify-pi-antigravity-oauth/account-command/cases.json`.

## Gotchas

- `Account: unknown` is expected in every local drive. userinfo is hard-coded to Google, and `fetchEmail` turns the refused call into `undefined`. Only a live account can prove that the email line is shown.
- The command reads the stored credential through `getApiKeyForProvider`. If that credential had expired, Pi would refresh it first against `oauth2.googleapis.com`, which the sink refuses. The drives store a far-future expiry to avoid this.
- The quota lookups share a 30-second timeout. A peer that hangs would hold the command open for that long.
