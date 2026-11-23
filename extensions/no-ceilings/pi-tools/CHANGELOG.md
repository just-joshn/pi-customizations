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
- Shell analysis refuses `trap` actions, `PS4` assignments, git `-c` command keys, and
  `GIT_CONFIG_*` environment. `install`, in-place `sed` and `perl`, `truncate`, and `find -delete`
  are writes. A redirect target ends at the next `<` or `>`, digits before a redirect stay with their
  word, and a redirect to `/dev/null` is not an outside write.
- The read fence keeps every record for the session, and a failed edit or write restores the record.
- A unified hunk counts its lines, so a `---` line inside a hunk is a removed line and a short hunk
  is refused. Duplicate add sections concatenate, and a hunk-less move or a `git diff -M` rename
  renames the file.
- Git literal operands obey read and write deny rules, `git -C`/`--git-dir`/`--work-tree` outside the
  workspace need approval, and a `git config` that writes a value is refused. A login shell is
  refused because it would source a profile.
- `tar -C`/`-f`, `curl -o`, `sort -o`, the `rsync` destination, and `find -fprint*` count as writes.
  Literal shell paths honor the ignore files, and a write to a protected ignore file is refused.
- A pure move copies the exact bytes of a binary file, a patch rollback restores exact bytes, and an
  edit or hunk application on a non-UTF-8 file is refused instead of rewriting it.
- A URL rule covers a trailing-dot host and a percent-encoded path.
- `>|` is one redirect and digits stay with the word or file name around a redirect. `printf -v` of a
  resolution variable is refused. `git bisect run` is refused, and git destinations (`init`,
  `apply --directory`, `archive -o`, `clone`, `worktree add`, `format-patch -o`, `bundle create`)
  are writes.
- `ditto`, `zip`, `unlink`, `rmdir`, and `shred` destinations are writes. `web_fetch` requires every
  redirect hop to be http or https, so a `file:` redirect is rejected before any request.
- An unquoted glob in a path operand is refused, and a shell that reads its script from stdin is
  refused in every spelling, including a glued redirect. `gzip`, `gunzip`, `bzip2`, `xz`, and
  `wget -O` destinations are writes, and `flock` joins the refused indirect wrappers.
- A write, redirect, or delete through a symlink to a protected ignore file is refused, as is a
  write to `<root>/.pi/pi-tools.json`. `write` and `save_resource` refuse a FIFO instead of blocking.
  A patch move refuses an existing destination.
- A regular file with more than one hard link is refused by the read, write, edit, delete, patch, and
  save paths, and dropped from grep and find results, because a path rule cannot see its other names.
- Shell recursion is refused: recursive grep and directory-walking rg/ag/ack cannot be checked against
  the ignore and read rules. A script fed to an interpreter on stdin is refused, as are the wrapper
  prefixes arch, xcrun, unshare, setarch, busybox, nsenter, docker, podman, and ssh.
- `sed` w/W and s///w destinations, split's prefix, openssl -out, unzip -d, and `git --output` are
  writes. A git index pathspec is checked as the path it opens, and a directory-wide stage or
  `git commit -a` is refused.
- An edit or delete of a read-denied path is refused, so the diff and snapshot cannot leak the body.
  `.git/config` and `.git/hooks/*` are protected from writes and deletes in the workspace root and in
  any repository nested below it.
- `curl -D`, `--trace`, `--trace-ascii`, and `-c` destinations are writes in spaced, `=` and glued
  forms, `rsync --log-file` is a write, and `split` checks its input as a read. `curl -K` is refused
  because its config names outputs and URLs.
- `patch` and `git apply` are refused because the patch file names the paths they write. `git grep`
  is refused because it chooses the files it reads, `git init --template` because the template
  installs a hook, and `git log --patch` without a path and `git show` without a path or summary flag
  because they print whole file bodies.
- A git revision path such as `HEAD:file` is checked as the file it opens, and a `git config` with a
  key and a value is refused even when a read flag is present.
- `git checkout-index`, `git fast-export`, and a raw-object or batch `git cat-file` are refused
  because they write or print files and objects the argv does not name. A directory, glob, or
  exclusion pathspec no longer narrows a `git log --patch` or `git show` refusal.
- The destination of `git mv` and `git init --separate-git-dir` are writes, `uniq` and `xxd` write
  their second operand, and `apply_patch` applies the read deny to every source it opens.
- Archive extraction is refused for `tar`/`pax` and for `unzip` outside its list and inspect forms,
  because the member names are paths the analyzer never reads.
- `git clone --template`, `git rebase --exec`, and `git stash show --patch` without a narrowing path
  are refused. The `GIT_*` variables that move the repository, index, editor, pager, or SSH command
  are refused and scrubbed, `git checkout` and `git restore` path operands are writes, and
  `git reset --hard`/`--merge`/`--keep` or a checkout/restore of a directory is refused.
- `zstd -o`, `pax -f`, `mkfifo`, and `mknod` destinations are writes.
- An unquoted process substitution is refused, because the splitter cannot keep the word after it with
  the command that opens it.
- `git --config-env`, `git --exec-path`, `git filter-branch`, `git clean` without a dry run, and a
  `git read-tree` that updates the worktree are refused, and `rsync -e`, `rsync --files-from`, `scp`,
  and `sftp` are refused because each runs or copies paths the argv only names.
- The tar-family write side covers `tar`, `bsdtar`, and `gtar`; `ditto -x` is refused as extraction;
  `ssh-keygen -f` and the `sqlite3` database operand are writes.

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
