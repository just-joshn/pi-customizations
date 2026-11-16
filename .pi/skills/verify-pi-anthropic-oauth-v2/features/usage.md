# Claude plan usage

Users run `/claude-usage` to see their subscription's usage percentages and reset times, or actionable guidance when a subscription login is unavailable.

## Sub-features

- `usage-logged-out-tui`: an empty profile receives login guidance in the TUI without a network attempt.
- `usage-logged-out-print`: print mode writes the same guidance to stderr, not stdout.
- `usage-live`: authenticated TUI and print display each server-provided limit and reset countdown.
- `usage-warning`: an above-normal limit is a warning.
- `usage-errors`: rejected auth, rate limits, invalid responses, and network errors are visible.

## How to get to it (user POV)

- Type `/claude-usage` in Pi's editor, or select it from slash-command completion.
- In a terminal, run `pi -p "/claude-usage"` with this extension loaded.

## Driving it with verify.py and tmux

Preconditions:

- Fresh isolated launch and successful doctor.
- For live paths only: complete [login](login.md) into the same scratch profile. The account determines which limits exist.

- **Logged-out TUI.** Run `"$V" drive "$E" --feature usage-logged-out-tui --step '/claude-usage' 'Claude is not logged in. Run /login and choose Anthropic (Claude subscription, OAuth).'`. Expect that full notice, then owned-child termination.
- **Logged-out print.** Run `"$V" print "$E" --feature usage-logged-out-print --message '/claude-usage'`. Require empty stdout, the exact guidance on stderr, and exit code 0 in `print.json`.
- **Side effects.** Run the skill's Python assertion block. Both driven processes must load the network observer; no request/socket attempt, credential creation, or workspace write is allowed.
- **Completion entry.** In a fresh interactive run, type `/claude-u` without Enter. Capture the `claude-usage` suggestion and its description `Show Claude subscription usage limits`; accept it with Tab and then Enter. Capture the resulting notice. This is separate from sending the full literal command.
- **Live TUI.** Send `/claude-usage` to the isolated interactive session; capture the action and rows such as `Current session:` with a percentage. If the server supplies a reset timestamp, require `resets in`; do not require nonexistent limit rows.
- **Live print.** After live TUI evidence, stop its tmux job but keep scratch, then run `"$V" print "$E" --feature usage-live-print --message '/claude-usage'`. Compare stderr's current rows with the TUI, allowing elapsed countdown time. Expect actual network-attempt records, not zero.
- **Warning/error cases.** Capture warning styling if the real account has an above-normal limit. Capture real rejection guidance if auth is rejected. Supporting deterministic checks: `bun run --filter @justjoshn/pi-anthropic-oauth-v2 test -- test/usage.test.ts`; these mock external HTTP and are not live account evidence.

## Gotchas

- Fresh seed state has no subscription. `usage-live`, `usage-warning`, and real HTTP error variants fail their precondition until the required account/server state exists. Report each as NOT VERIFIED rather than fabricating a response.
- Normal accounts may report no limits; `Claude reported no usage limits for this plan.` is legitimate, but does not prove rendering of nonempty rows.
- The command resolves extension-provider auth regardless of the currently selected chat model.
- Print mode returns 0 even for the login error notice. Require the exact stream contents.
- Slash completion is another mapped entry point; the automated full-command journey does not cover it.
