# Aider response ordering

Inspected directly during recovery of failed delegates. Source is `/Users/josh-desktop/src/experiments/aider/aider/coders/base_coder.py` at pinned checkout `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`. This is a partial grounding report, not the complete lifecycle trace.

## User-message boundary

`init_before_message` at line 864 resets edited files, reflected message, reflection count, lint/test outcomes, shell commands, and message cost. It records the current HEAD when a repository exists.

`run_one` at line 924 initializes once, optionally preprocesses input, then calls `send_message` repeatedly. It clears the reflected message before each response. A nonempty reflection triggers another response only when the existing count is below `max_reflections`. The counter increments immediately before that next response. Reaching the cap emits the exact warning `Only {max_reflections} reflections allowed, stopping.`

## Response boundary

`send_message` at line 1419 appends the user input, assembles context, checks token limits, then performs transport. After transport it finalizes response content and records the assistant reply.

Post-response ordering is significant.

1. Exhausted context returns before editing.
2. File-mention handling can request a reflection and return before `reply_completed` or editing.
3. `reply_completed` can terminate the response pipeline. Base implementation at line 1625 is empty; subclass behavior remains to inspect.
4. An interrupted response adds interruption history and returns without applying edits.
5. `apply_updates` returns the set of edit targets.
6. A nonempty set updates message-level edited files, attempts auto-commit, and moves current messages back with a saved-message acknowledgement.
7. A pending reflection returns here, before lint, suggested shell commands, or tests.
8. Automatic lint runs only after edits. It attempts a second commit with context `Ran the linter`. Accepted lint repair returns with a reflection before shell commands and tests.
9. Suggested shell commands run. Shared output adds a user message followed by assistant content `Ok` without a period.
10. Automatic tests run only after edits. Accepted test repair sets the next reflection.

## Edit boundary

`apply_updates` at line 2296 calls `get_edits`, `apply_edits_dry_run`, `prepare_to_edit`, computes the target-path set, and finally calls `apply_edits`.

The target-path set exists before application. A partial application failure can therefore return all prepared targets, not merely paths successfully written. ValueError and general exceptions request reflection. Git errors report an error without requesting reflection. Do not silently reinterpret the returned set as proof of successful writes.

## Subclass transitions

`architect_coder.py:11` asks `Edit the files?` for nonempty responses unless auto-accept is configured. It creates an editor coder using the editor model (or main model fallback) and the main model's editor edit format. The editor disables suggested shell commands, repository-map tokens, prompt caching, cache warming, and summary transfer. It clears both history lists and runs the architect response as user input with preprocessing disabled. Afterwards it moves the architect history back with `I made those changes to the files.` and copies total cost and assistant commit hashes from the editor. The method returns None, not True. The parent pipeline therefore continues after the nested editor finishes.

`context_coder.py:21` returns True for empty content, an unchanged selected-file set, or reflection count at least `max_reflections - 1`. Otherwise it replaces the editable file set with mentioned files and requests the `try_again` reflection. Its file-mention hook is disabled. Constructor lines 14-18 force map refresh and expand the map budget. Those map effects belong to the later map feature.

## Permission ordering

`base_coder.py:2191` first accepts already-editable files and checks their dirty-commit eligibility. Only afterwards does it reject gitignored files. For missing files it asks `Create new file?`, touches the path unless dry-run, optionally stages it, then adds it to the editable set. For existing unselected files it asks permission, optionally stages, adds to the set, and checks dirty-commit eligibility.

`prepare_to_edit` at line 2269 memoizes each path's permission result within the batch. Path-less edits bypass permission filtering. After all permissions it calls `dirty_commit`, then clears the pending dirty-file set. This ordering is a source baseline, not approval of documented dry-run or patch precreation defects.

## History and request assembly

`move_back_cur_messages` at line 1036 appends current history to done history, starts summarization, optionally appends a user notice plus assistant `Ok.`, and clears current history.

`format_chat_chunks` at line 1226 chooses fences and formats the main system prompt. It optionally embeds examples into that prompt. Separate examples get a codebase-reset user notice and assistant `Ok.`. The system reminder is appended to the main prompt and can also appear at the request tail. Models without system-message support get a user/assistant pair instead.

`chat_chunks.py:16` defines exact output order as system, examples, readonly_files, repo, done, chat_files, cur, reminder. Declaration order of fields differs from output order.

Tail-reminder capacity arithmetic includes the current-message token count in addition to all assembled messages. Unknown token counts yield zero. Preserve this baseline pending a separately evidenced defect decision. A user reminder modifies a copied final user message, not the original current-history message.

## Remaining questions

Full file-content formatting, model-specific transport parameters, commands, confirmation semantics, and state transfer during coder creation still require tracing. Pi persistence and continuation are being examined separately. No complete Pi mapping is asserted by this report.
