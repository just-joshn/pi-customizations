# Native requests

A signed-in user sends a prompt to the selected Google Gemini model and receives streamed text in Pi, or a final result from print/JSON CLI. Provider failures remain visible and are not rewritten into unsupported claims about quota.

## Sub-features

- `request-tui`: prompt and streamed/final response through the editor.
- `request-print`: one-shot print output and exit status.
- `request-json`: native JSON assistant events and a successful stop reason.
- `request-error`: honest status/error text when Google refuses a request.

## How to get to it (user POV)

- Choose a `google-oauth-v2` model using `/model`, type a prompt, Enter.
- Run Pi with explicit provider/model and `--print` or `--mode json`.

## Driving it with native Pi/tmux

Preconditions:

- Real Google OAuth login, project resolved, reachable provider, owner's permission to consume plan quota. Restart the TUI without `--offline`; do not treat offline mode as a dry-run prompt.
- Use a model shown in the refreshed catalog; examples below exercise Flash. If missing, report that exact precondition failure.

- **TUI request.** Capture selected model/footer; record action and send `printf 'Reply with exactly GOOGLE_VERIFY_OK and nothing else.\r' > "$INPUT"` through the PTY FIFO. Capture streaming/progress then final `GOOGLE_VERIFY_OK` with model identity and the input visible. Wait for the editor to become idle. A captured intermediate response is not final-response proof.
- **Print.** Run `python3 "$HELPER" run "$EVIDENCE" -- --provider google-oauth-v2 --model gemini-3.8-flash --thinking medium --no-tools --print 'Reply with exactly GOOGLE_VERIFY_OK and nothing else.'`. Require exit 0 and stdout (trimmed) exactly `GOOGLE_VERIFY_OK`; inspect stderr for errors.
- **JSON.** Run `python3 "$HELPER" run "$EVIDENCE" -- --provider google-oauth-v2 --model gemini-3.8-flash --thinking medium --no-tools --mode json 'Reply with exactly GOOGLE_VERIFY_OK and nothing else.'`. Require valid JSONL, final assistant `message_end` with `stopReason: stop`, exact text, and no assistant error. Retain native events, not only a parsed success flag.
- **Provider failure.** If a request actually returns an error, capture safe status/message and resulting UI/CLI state. A 429 is not successful completion and does not prove the account quota was unaffected. Do not intentionally burn quota or repeatedly call the service to force this branch.
- **Side effects.** After requests run doctor, then cleanup; require normal profile unchanged. Print/TUI runs use no persisted session and no tools, so there should be no application-created work files. Observe the scratch work directory before cleanup and record its file names.

## Gotchas

- CLI exit 0 alone can accompany an assistant error; inspect final text/events as well.
- Exact-output mismatch is a failed assertion even if the model answered something plausible. Keep the actual safe output.
- Cost shown as zero means subscription per-token pricing is zero in Pi, not unlimited free requests. Real plan quota is shared.
- Refreshing copied credentials proves a request path, not login UI. No live credentials means this journey remains NOT VERIFIED; the offline selector journey is not a substitute.
