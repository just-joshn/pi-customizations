# Models

Users pick Claude models under `custom-anthropic/...` and send prompts through the extension's own streaming code. The model list is Pi's built-in Anthropic catalog with ` (Custom)` added to each name, so new Claude models appear when Pi updates.

## Sub-features

- `models-list`: `pi --list-models custom-anthropic` lists the catalog once credentials exist.
- `model-picker`: `/model` shows rows like `Claude Sonnet 4.6 (Custom) [custom-anthropic]`.
- `model-direct`: `/model custom-anthropic/<id>` switches the footer to `<id> • <thinking level>`.
- `model-cli`: `--model custom-anthropic/<id>` selects it at startup.
- `model-response`: a real assistant response under the selected model.
- `model-thinking`: adaptive-thinking models send `thinking: adaptive` with an effort matching Pi's thinking level, and older models send a token budget.

## How to get to it (user POV)

- Run `/model` or press Ctrl+L, and filter by `custom-anthropic`.
- Run `/model custom-anthropic/claude-opus-4-6`.
- Launch Pi with `--model custom-anthropic/claude-sonnet-4-6`.
- Run `pi --list-models custom-anthropic`.

## Driving it with verify.py and tmux

Preconditions: fresh `init` and passing doctor per journey. The helper always launches with `--model custom-anthropic/claude-sonnet-4-6`. Pi lists only models whose provider has credentials, so offline listing needs `--fake-api-key`.

- **List (zero network).** `"$V" list-models "$E" --feature models-list --fake-api-key`. `list-models.json` must show `custom-anthropic` rows and exit 0. Without the flag the list is empty, which is not a registration failure.
- **Picker (zero network).** `"$V" drive "$E" --feature model-picker --fake-api-key --step '/model' '(Custom)'`. Capture the `(Custom) [custom-anthropic]` row.
- **Direct switch (zero network).** `"$V" drive "$E" --feature model-direct --fake-api-key --step '/model custom-anthropic/claude-opus-4-6' 'claude-opus-4-6 •'`. The transcript shows `Model: claude-opus-4-6` and the new footer.
- **Response.** After a real [login](login.md), send `Reply with exactly OAUTH_VERIFY_OK; do not call tools.` in `TARGET` and capture the assistant text. Or stop the job, keep scratch, and run `"$V" print "$E" --feature model-cli`. An actual response proves this entry; the flag alone does not.
- **Thinking.** With a real login, set a thinking level (Shift+Tab) on an adaptive model such as `claude-opus-4-6`, send a prompt, and capture the thinking block. Supporting evidence: `npx tsx extensions/pi-anthropic-oauth-v2/scripts/verify-wire.ts` and `test/provider.test.ts` check the request body against a local server.

## Gotchas

- `--list-models` and the picker show nothing for this provider in an empty profile.
- Catalog contents come from installed Pi. If the pinned `claude-sonnet-4-6` disappears, update `MODEL` in `verify.py` on purpose; do not swap providers.
- The helper disables tools, so a paid prompt cannot modify the repository.
- A response through built-in `anthropic` does not prove extension behavior.
