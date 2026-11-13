# Usage

`/usage` reads the Grok Build credential and calls `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`. It prints the plan meter: the period, percent used and left, time until reset, each product's share, the prepaid balance, and whether billing is unified. In the TUI it is a notification. In print mode it goes to stderr. The URL is hardcoded and does not follow `models.json`.

## Sub-features

- `usage-logged-out`: `Grok Build is not logged in. Run /login and choose Grok Build.` and no request.
- `usage-streams`: in print mode, stdout stays empty and every `/usage` line is on stderr.
- `usage-meter`: the request carries `Authorization: Bearer <access>`, `X-XAI-Token-Auth: xai-grok-cli`, and `x-grok-client-version: 1.0.70`. The output reads `Weekly <start> to <end>: 17% used, 83% left, resets in 5d 3h 0m` (or `5d 2h 59m` when a minute boundary passes between serving and printing), then `GrokBuild: 15%`, `Cursor: 2%`, `Prepaid: 0`, `Unified: yes`.
- `usage-rejected`: on 401, `Grok Build rejected the session (HTTP 401). Run /login and choose Grok Build.`
- `usage-tui`: the same meter appears as a TUI notification.

## How to get to it (user POV)

- In interactive Pi, type `/usage`.
- `pi -p /usage`.

## Driving it with control-x-subscription-oauth

Preconditions:

- `doctor` passes, including `tmux`.
- The peer serves `test/fixtures/billing-credits.json` with the period moved to start 2 days ago and end 5 d 3 h from now, so "resets in" is predictable. Its second billing call returns 401.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth drive usage`.
- **Logged out.** The drive runs `pi --offline -p /usage` with no credential and gets the not-logged-in line. The peer saw 0 requests.
- **Meter.** The drive stores a credential and runs `pi --offline -p /usage`. The output matches `usage-meter`.
- **Rejected.** The drive runs `pi --offline -p /usage` again and gets the HTTP 401 line.
- **TUI.** The drive starts the TUI, types `/usage`, and presses Enter. The pane shows `GrokBuild: 15%` and `17% used, 83% left` (`tui-usage.txt`).
- **Proof.** `steps.json` records each print run's stderr and all three billing requests (meter, 401, TUI) with its summary, command output, requests, and stored credentials (scrubbed), and `egress.json` holds the refused tunnels and the guard log, which the harness checks after every drive. The TUI output is in `tui-usage.txt`.

## Gotchas

- Pi's print-mode output guard (`core/output-guard.js` in Pi 1.5.2) redirects every `process.stdout.write` to stderr. An extension that wrote `/usage` to stdout would still reach the user on stderr, so the drive cannot tell the two apart. Its stdout-empty check guards the user-visible contract, not the call the extension makes.

- `/usage` always uses the Grok Build credential, even for a Cursor-only user. With only a `cursor` credential it reports not logged in.
- "resets in" is computed from the clock. Any drive that serves a fixed date eventually prints `0m`, so keep the period relative to now.
- The fetch has a 30 s timeout. A peer that hangs holds the command for that long before it prints an error.
