# Models and thinking

Users see one entry per Gemini family, select the Google provider, and choose only the thinking levels available for that family. Authenticated refresh discovers the account's actual models; a fresh offline profile offers two baseline families.

## Sub-features

- `models-no-auth`: empty profile reports no available models rather than pretending to be signed in.
- `models-baseline`: native CLI lists baseline Argon and Flash offline once real OAuth is configured.
- `models-slash`: `/model` selects a Google model and changes the footer.
- `models-shortcut`: Ctrl+L opens the same selector and can change models.
- `thinking-slash`: `/thinking` offers supported levels and selects one.
- `thinking-cycle`: Shift+Tab cycles available levels.
- `models-refresh`: authenticated startup publishes the plan-specific catalog/cache.

## How to get to it (user POV)

- Run `pi --list-models google-oauth-v2` with the extension loaded.
- In Pi, run `/model` or press Ctrl+L, then search the desired model/provider.
- Run `/thinking` or press Shift+Tab to change effort.
- After `/login`, start a fresh online Pi session to refresh the Google catalog.

## Driving it with native Pi/tmux

Preconditions:

- Launch/doctor from the skill. First observe the empty-profile state. For baseline selection, explicitly copy real Google OAuth via `copy-auth` (not login proof), or complete login, then start `serve-tui` offline. No catalog cache is copied; footer shows `gemini-3.8-flash`.
- Use a different fresh run for authenticated catalog proof; do not label fallback models as a successful remote refresh.

- **No auth.** Before `copy-auth`/login, run `python3 "$HELPER" run "$EVIDENCE" -- --offline --list-models google-oauth-v2`. Record exit 0 with `No models available`; this is not baseline-catalog proof. Missing auth is the reason an empty-profile selection journey cannot proceed.
- **CLI baseline.** With real OAuth configured, run `python3 "$HELPER" run "$EVIDENCE" -- --offline --list-models google-oauth-v2`. Require exit 0 and rows for `google-oauth-v2` / `gemini-4-argon` and `gemini-3.8-flash`, without separate `-low`, `-medium`, `-high` model-family rows. Save command/stdout/stderr/exit artifacts.
- **Slash selector.** Save ready pane, record/send `/model` + Enter, and wait for the model list. Type `google-oauth-v2` as its search and capture both baseline families. Press Escape to leave it without changing selection. Open `/model` again, type `gemini-4-argon`, verify the sole matching Google row, press Enter, and capture the footer showing `gemini-4-argon`. Use `printf '/model\r' > "$INPUT"`, then wait for the picker before `printf 'google-oauth-v2' > "$INPUT"`. All input uses this run's PTY FIFO; see the skill for key-byte recipes.
- **Keyboard selector.** Record/send `printf '\014' > "$INPUT"` (Ctrl+L). Wait for the model list, search `gemini-3.8-flash`, verify the highlighted Google row, Enter. Capture footer `gemini-3.8-flash`. A picker screenshot alone is insufficient selection proof.
- **Thinking picker.** Record/send `/thinking` + Enter. On the baseline family require low/medium/high available and off/minimal unavailable. Capture the menu. Select `high` using its rendered label (navigate relative to observed highlight, not fixed tab order), Enter; require high in footer/editor state.
- **Thinking shortcut.** Send `printf '\033[Z' > "$INPUT"` (Shift+Tab), capture before/after. Require a change to another supported effort, never an unsupported level.
- **Remote catalog.** Start an online authenticated TUI after actual login (or explicitly authorized `copy-auth`). Open `/model`, search `google-oauth-v2`, capture discovered families, and inspect file names/metadata in the scratch agent's `models-store.json`. Require a newly written `google-oauth-v2` catalog entry and selectable model; do not print credentials. Test the selected model with a live request. For actual `-medium` wire-ID proof use the existing probe in the instructions/tools map.

## Gotchas

- Offline readiness with copied real OAuth proves extension registration/selection, not Google availability or login. Baseline names are Argon and Flash, while the existing live probe additionally expects discovered Hydrogen.
- Provider labels/model names can differ from IDs; verify both the matched row/provider and resulting footer. Do not select by an unobserved arrow count.
- Ctrl+L and `/model`, `/thinking` and Shift+Tab are separate coverage. Do not claim a complete feature pass after only CLI listing.
- Model-cache files are side effects in scratch. Their presence alone is not a network receipt or proof that every listed model can answer.
- If remote discovery lacks a model needed by another mapped journey, report the missing family as an unmet precondition; do not substitute a fallback while calling that journey passed.
