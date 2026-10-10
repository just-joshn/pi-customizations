# Aider file context and coder switching

This is a direct source trace of the pinned Aider checkout at `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`. It covers the methods listed below. It is not runtime proof or a complete lifecycle investigation.

## Coder replacement

`Coder.create()` treats `code` as an unspecified format. An unspecified format keeps the previous coder's format when a previous coder exists. Otherwise, it uses the model default. `aider/coders/base_coder.py:125-150`.

When the format changes, `summarize_from_coder` is true, and completed history is nonempty, `create()` asks the previous summarizer to summarize that completed history. A `ValueError` retains the original history and emits `Chat history summarization failed, continuing with full history`. `aider/coders/base_coder.py:151-169`.

Replacement starts with a copy of `original_kwargs`. It then transfers editable paths, read-only paths, completed history, current history, assistant commit hashes, a cloned command object, cost, ignored mentions, token counters, and the file watcher. Explicit new keyword arguments override the transferred values. The previous coder's `ok_to_warm_cache` becomes false. `aider/coders/base_coder.py:170-189`.

`/model` changes the format to the new model's default only when the active format was the old model's default. `/chat-mode code` selects the main model's default and disables format-change summarization. `/chat-mode ask` also disables that summarization. Other accepted modes retain its default of true. `aider/commands.py:87-112,138-204`.

These facts do not authorize a replacement compaction system in Pi. The native mapping for format-change summarization remains unresolved.

## File reads and context messages

`get_abs_fnames_content()` reads a snapshot of the editable-path set. A failed read warns `Dropping <relative path> from the chat.` and removes that path from the editable set. A failed read of a read-only file does not remove that path. `aider/coders/base_coder.py:598-607,659-671`.

`choose_fence()` reads editable and read-only contents. It tests candidates in order against line prefixes. It uses the first collision-free pair or warns and falls back to the first pair. This process can remove unreadable editable files through `get_abs_fnames_content()`. `aider/coders/base_coder.py:609-635`.

Text-file context concatenates a leading newline, the relative filename, a newline, the opening fence, another newline, the exact read content, the closing fence, and a final newline. It does not insert a newline between content and the closing fence. Image files are excluded from these text blocks. `aider/coders/base_coder.py:637-671`.

`get_files_content(fnames)` assigns a default to `fnames` but then iterates `get_abs_fnames_content()` without passing that argument. The current code does not use `fnames` to select a subset. `aider/coders/base_coder.py:637-657`.

Read-only text becomes a user message with the format's `read_only_files_prefix`. Its paired assistant message is `Ok, I will use these files as references.`. Read-only images have a separate user message and `Ok, I will use these images as references.`. `aider/coders/base_coder.py:763-787`.

Editable text uses the format's file prefix and assistant reply. With no editable files, the repository-map branch can supply another pair. Otherwise, the no-full-files prompt pairs with `Ok.`. Editable images also pair with `Ok.`. `aider/coders/base_coder.py:789-815`.

The image method checks model vision and PDF metadata, labels the file, and embeds a base64 data URL. This trace does not establish equivalent PDF support in public Pi message types. `aider/coders/base_coder.py:817-858`.

Editable and read-only content methods iterate sets without sorting. `get_inchat_relative_files()` separately returns sorted unique relative names. `get_all_relative_files()` returns sorted tracked names when a repository exists and sorted in-chat names otherwise. It does not walk all workspace files when Git is disabled. `aider/coders/base_coder.py:598-607,659-671,2137-2174`.

## File commands

`parse_quoted_filenames()` recognizes double-quoted spans or non-whitespace words with a regular expression. It is not shell parsing. `aider/commands.py:1694-1697`.

`/add` first resolves literal files and directories. Directory matching escapes glob metacharacters. Its glob helper expands subdirectories, restricts results to the root, and, with a repository, filters against tracked files. No-match creation rejects wildcard `*` and `?`, then asks before creating parents and touching a file. Matched files are processed in sorted order. `aider/commands.py:765-850`.

`/add` checks ignored files, outside-root paths under its auto-commit condition, Git-ignore policy, and duplicate editable membership. A read-only file can be promoted when repository membership or the no-repository root check permits it. For a new member, the command checks image support and read success before adding it. These are different branches, not one shared validation pass. `aider/commands.py:806-899`.

`/read-only` with no arguments converts every editable path to read-only. With arguments, it expands `~`, prefers literal existence over globs, sorts matched paths, and dispatches files and directories separately. The single-file branch checks vision support and duplicates. The directory branch walks files, adds previously unshared paths, and does not call the single-file branch. `aider/commands.py:1328-1423`.

`/drop` with no arguments clears editable paths and retains only currently read-only paths that match the original read-only arguments. It does not restore an original read-only file that was promoted to editable. With arguments, read-only matching uses substring or same-file identity. Editable matching uses a glob when glob characters occur and substring matching otherwise. `aider/commands.py:417-437,912-969`.

`Commands.clone()` preserves `original_read_only_fnames`. `/clear` clears both history lists. `/reset` drops files through the same preservation rule and clears both lists. `aider/commands.py:40-51,411-444`.

`/ls` separates tracked or known names into editable and other files, then adds relative read-only names. Its output distinguishes those groups. Its read-only loop is not explicitly sorted. `aider/commands.py:1064-1101`.

## Remaining evidence

No command or context probe was run for this trace. Root canonicalization, quoted-path boundary cases, command confirmations, startup-file handling, model settings, and mode-specific prompts still require deterministic oracle cases and real Pi lifecycle verification. Unsorted set iteration needs an explicit test strategy. No behavior in this report is marked verified in the parity ledger.
