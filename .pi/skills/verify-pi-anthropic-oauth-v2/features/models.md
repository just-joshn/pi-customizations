# Select Claude and send a prompt

Users select Claude models under the extension's provider prefix and send a real prompt billed through their subscription, while the built-in Anthropic provider remains available independently.

## Sub-features

- `model-picker`: select an extension model through `/model`.
- `model-shortcut`: reach the same selector through Ctrl+L.
- `model-direct`: switch by full provider/model through the direct slash command.
- `model-cli`: choose the extension provider explicitly on startup.
- `model-response`: receive an actual assistant response under the selected provider.
- `model-builtin`: built-in Anthropic remains separately listed.

## How to get to it (user POV)

- Run `/model` or press Ctrl+L.
- Run `/model anthropic-oauth-v2/claude-sonnet-4-6`.
- Launch Pi with `--model anthropic-oauth-v2/claude-sonnet-4-6`.
- Use `pi --list-models anthropic-oauth-v2` after signing in.

## Driving it with verify.py and tmux

Preconditions:

- Launch and doctor pass. A valid disposable subscription login is required for an assistant response and authenticated model listing.
- The helper's baseline already selects `anthropic-oauth-v2/claude-sonnet-4-6` through the real CLI flag.

- **Picker entry.** Send `/model`, filter by `anthropic-oauth-v2/claude-sonnet-4-6`, and capture the exact provider/model before Enter. Capture the selected model in the footer. A footer showing only the model ID needs the picker/launch argv as provider evidence.
- **Shortcut entry.** Send `tmux send-keys -t "$TARGET" C-l`; filter by the same full provider/model, capture, and select. This entry point is not covered by the slash-command capture.
- **Direct switch.** Send `/model anthropic-oauth-v2/claude-sonnet-4-6`; capture the confirmation and footer. This direct command is distinct from selecting a menu row.
- **Built-in provider.** Reopen the picker, filter by `anthropic/`, and capture its separate provider identity without sending a request through it. If the picker hides unauthenticated built-in models, record that unmet precondition instead of adding a second login silently. Return to the extension model.
- **Send prompt.** After authorized login, send `Reply with exactly OAUTH_VERIFY_OK; do not call tools.` and capture the submitted prompt and resulting assistant text. Require no authentication/request error. Do not claim exact deterministic wording if the model deviates; report what appeared.
- **CLI entry.** In a fresh authenticated evidence run/profile, or after stopping its interactive job while retaining scratch, run `"$V" print "$E" --feature model-cli --message 'Reply with exactly OAUTH_VERIFY_OK; do not call tools.'`. `print.json` records the explicit model flag, actual assistant stdout, stderr, and exit code. An actual response proves this entry; the flag alone does not.

## Gotchas

- Fresh logged-out state can launch with an explicit model but cannot prove a paid request. Report `model-response` and authenticated listing as NOT VERIFIED until sign-in.
- Pi's `--list-models` reports no models for the empty profile because it lists available authenticated models. That is not evidence that extension registration failed.
- The helper disables tools, so this small paid prompt cannot modify the repository.
- Catalog contents come from installed Pi. Do not replace a missing pinned model with a different provider silently; record the failure and refresh the skill intentionally.
- A response through built-in `anthropic` does not prove extension behavior.
