# Changelog

## Unreleased

- Shell analysis decodes ANSI-C `$'...'` escapes, strips leading assignments before the executable,
  unwraps `timeout`, `nice`, `stdbuf`, and `setsid`, and resolves `~`, `$HOME`, `$PWD`, and `$OLDPWD`
  in `cd` targets.
- A command the analyzer cannot vouch for is refused before it runs: a command word built by an
  expansion, an unresolvable `cd` target, an inline `BASH_ENV`/`ENV`/`CDPATH`/`IFS`, an indirect
  wrapper (`sudo`, `xargs`, `find -exec`, `env -S`), a script piped into a shell, and a function
  definition.
- Every spawned shell drops `BASH_ENV`, `ENV`, `CDPATH`, `SHELLOPTS`, `BASHOPTS`, and exported
  functions, and pins `PWD`/`OLDPWD`, so the verdict matches the command that runs.
- A search rooted at a workspace path that resolves outside is refused, like `read` of the same path.
- `apply_patch` rolls back every file it already changed when a later write fails, and a zero-context
  insertion keeps its place after earlier hunks.
- `delete` refuses a protected ignore file, so the ignore set cannot be removed to un-filter a path.
- A URL rule that names a host or a path prefix also denies every URL beneath it.
- `read` reports the lines it returned without parsing `\n\n[` in the file; `grep` sets each match's
  `truncated` flag; `edit` counts replaced occurrences; `find` names a file root instead of `.`;
  `write` refuses malformed base64; concurrent session builds are keyed by directory.
- Shell analysis skips reserved words, joins backslash-newline continuations, skips `--` before
  `sh -c`/`eval` bodies, resolves `~currentuser`, and refuses brace expansion, an unquoted command
  substitution or backtick anywhere (including a here-string), and `~otheruser`. Assignments after
  `env` get the same startup-variable checks as leading ones. Literal path operands and redirection
  targets obey read and write deny rules, and write-like commands or targets outside the workspace
  need approval.
- A symlink is followed even when its target does not exist, so containment, deny rules, and ignore
  files see the file a writer would create.
- The read fence is keyed by canonical file identity, so a symlink or case alias shares one record;
  a ranged read no longer clears a full-read record; `edit` treats a file recreated after `delete`
  as stale; `write` and `delete` record their fence inside the file queue, so concurrent writers
  cannot leave a fingerprint for bytes that are gone.
- A `dir/` ignore pattern matches only a directory, the first line of a BOM file is editable with the
  text `read` returned, an empty patch is refused, a failed add removes the directories it created,
  a base64 write reports the decoded line count, and a tail read of an empty file invents no line.
- Shell analysis scans `${...}` and `$((...))` bodies for substitutions, refuses startup assignments
  through `export`/`declare`/`typeset`/`readonly`, refuses `alias` and `git -c alias.*=!`, treats
  every `ln` target and `find -delete` as a write, adds `truncate`, and refuses `caffeinate` and
  other indirect wrappers. `cp`/`mv`/`ln` `-t` and `--target-directory` destinations are writes.
- A URL host or path-prefix rule covers the same host on any port and URLs with a query or fragment.
- The read fence has no lifetime and covers any file size; `delete` records the path it removed, not
  a symlink's target. Read text carries the digest, a fractional offset is rejected, `grep` limits
  and totals count matches rather than context lines, patches keep untouched endings and honor the
  trailing newline, `ls` follows directory symlinks inside the workspace, and `save_resource` rejects
  malformed base64.

## 0.1.0

- Initial release of the Pi-native local tool-execution layer.
- Filesystem tools: `read`, `ls`, `find`, `grep`, `write`, `edit`, `apply_patch`, `delete`, overriding
  the Pi built-ins of the same names where one exists.
- Execution and auxiliary tools: `bash` (working directory, environment overrides, timeout, streamed
  output, exit status), `git`, `web_fetch`, `web_search`, `save_resource`.
- Permission policy with `unrestricted`, `auto`, and `allowlist` modes, read/write/exec rules, and
  approval prompts through `ctx.ui.confirm`.
- Ignore handling for `.gitignore`, `.ignore`, and `.piignore` across search, listing, and glob.
- Read fences for stale-write detection, post-write digest verification, case-folding collision
  refusal, and binary-file refusal.
- Content search with result limits, output caps, line truncation, and partial results on timeout.
- `search_tools` for tool-schema discovery and dynamic activation of the auxiliary tools.
