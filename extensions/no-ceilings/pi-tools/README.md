# pi-tools

A Pi-native local tool-execution layer. It gives the agent permissioned filesystem access, capped
searches, verified mutations, patch application, a shell with a working directory and environment
overrides, git, web egress, and resource saving.

Every tool is built from Pi mechanisms: `registerTool`, Pi's own tool factories, `withFileMutationQueue`,
`pi.exec`, `ctx.ui.confirm`, `tool_call`/`tool_execution_*` events, and Pi's schema validation. Nothing
here reimplements the agent loop, validation, MCP, codemode, or truncation.

## Install

The package is a Pi package. Add it to a profile with `pi install` (npm or git), or load the source
directly:

```bash
pi -e ./extensions/no-ceilings/pi-tools/src/index.ts
```

The extension registers on load. Tools marked inactive in the table below load through `search_tools`
when the model needs them.

## Tools

| Tool | What it does |
| --- | --- |
| `read` | Reads text or images. Integer `offset`/`limit`, negative offset for a tail, binary refusal, ignore and permission checks, size/line/digest metadata in the result, and a read fence for later writes. |
| `ls` | Lists a directory, optionally to a depth, sorted, with directories and symlinked directories suffixed. Applies ignore files, permission rules, extra globs, an entry limit, a name budget, and a five second budget. |
| `find` | Glob matching for files and paths through ripgrep. Ignore files, permission rules, a result limit, and partial results on timeout. |
| `grep` | Content, file, and count search modes with regex or literal patterns, context lines, glob and type filters, offset and limit over matched lines, line truncation, output caps, and partial results on timeout. |
| `write` | Creates or overwrites a file with parent directories (UTF-8 or validated base64), refuses case-folding collisions and stale files, verifies the bytes on disk, and reports size and line count. |
| `edit` | Exact text replacement with several disjoint edits or `replaceAll`, overlap and no-op detection, stale-file refusal, BOM and line-ending preservation, and a diff plus patch. A file that is not valid UTF-8 is refused instead of rewritten. |
| `apply_patch` | Multi-file patches in the `*** Begin Patch` format or a unified diff. A read-denied source is refused, every hunk is validated before anything is written, untouched lines keep their endings, and a write failure rolls back the files and directories the call created. |
| `delete` | Deletes one file, keeps the previous contents when small, and refuses directories, ignored paths, protected ignore files, and files that changed after the check. |
| `bash` | Shell commands with `cwd`, environment overrides, an optional timeout, streamed output, an exit code, output spill to a file, and process-tree interruption. |
| `git` *(loads on demand)* | Runs a git subcommand through the local executable with captured output and an exit code. |
| `web_fetch` *(loads on demand)* | Fetches an http(s) URL, reduces HTML to text, caps the body, and can save it to a file. |
| `web_search` *(loads on demand)* | Queries the endpoint configured under `web.search` and returns references. |
| `save_resource` *(loads on demand)* | Writes tool-produced UTF-8 or validated base64 content to a permitted file with a digest and overwrite protection. |
| `search_tools` | Finds the tools above that are not yet declared, prints their argument schemas, and activates them. |

`read`, `ls`, `find`, `grep`, `write`, `edit`, and `bash` override Pi's built-in tools of the same
name, so the layer replaces the built-ins instead of duplicating them. The remaining tools are new.
`write` and `save_resource` refuse a FIFO or other non-regular file instead of blocking on it, and a
write, redirect, or delete through a symlink to a protected ignore file or to `.pi/pi-tools.json` is
refused like the direct write. `.git/config` and everything under `.git/hooks/` are protected too, in the
workspace root and in any repository nested below it, so the agent cannot install a hook or an
fsmonitor command that git runs later.

## Configuration

Settings load from `~/.pi/agent/pi-tools.json`, then `.pi/pi-tools.json` in the workspace. Project
settings load only when the project is trusted. Environment overrides:

| Variable | Effect |
| --- | --- |
| `PI_TOOLS_MODE` | `unrestricted`, `auto`, or `allowlist`. |
| `PI_TOOLS_RULES` | Comma-separated `kind:action:pattern` rules appended after the files. |
| `PI_TOOLS_IGNORE_FILES` | Comma-separated ignore file names. |

```json
{
  "mode": "auto",
  "workspaceRoots": ["."],
  "ignoreFiles": [".gitignore", ".ignore", ".piignore"],
  "rules": [
    { "kind": "read", "action": "deny", "pattern": "**/.env" },
    { "kind": "write", "action": "deny", "pattern": "**/secrets/**" },
    { "kind": "exec", "action": "deny", "pattern": "npm publish*" }
  ],
  "web": {
    "search": {
      "url": "https://api.example.com/search?q={query}",
      "headers": { "authorization": "$SEARCH_API_KEY" },
      "resultsPath": "results"
    }
  }
}
```

### Modes

| Mode | Behavior |
| --- | --- |
| `unrestricted` | Deny rules only. No prompts. |
| `auto` (default) | Deny rules win. Reads, writes, deletes, searches, and commands inside the workspace run without a prompt. Writes and deletes outside the workspace, and network egress, ask through `ctx.ui.confirm`; without a UI they are refused. |
| `allowlist` | Only calls matching an allow rule run. Everything else is refused without a prompt. |

Rules are checked in order for a match of the same kind and action. A deny match always wins over an
allow match. Path rules match the absolute path and each workspace-relative path, with `*` matching a
path segment and `**` spanning segments; a pattern without `/` matches a file name at any depth. Exec
rules match each analyzed command segment, so an absolute path or a wrapper does not hide the command
the shell runs. A URL rule that names a host or a path prefix also covers everything beneath it.

Searches are the exception to the outside-workspace prompt: naming a directory explicitly lets the
layer search it, because that is the point of passing a path. Deny rules and allowlist mode still apply.
A workspace path that resolves outside the workspace is refused rather than treated as an explicit
outside root.

### Ignore files

`.gitignore`, `.ignore`, and `.piignore` are read from each workspace root and its ancestors.
`.gitignore` and `.ignore` are honored by ripgrep directly and by the layer's own resolver; `.piignore`
is applied by the resolver as a post-filter, so it applies outside a git repository too. A pattern that
ends in `/` matches only a directory. Listing and reading use the same verdict. A tool call that names
an ignored path directly is refused with the ignore file that matched, including a literal shell
operand or redirect target.

## Behavior worth knowing

- **Writes are fenced.** A full-file `read` records a fingerprint for the rest of the session, with no
  expiry and for a file of any size, keyed by the file's canonical identity, so a read through a symlink
  or another case spelling fences the same file. A later `write` or `edit` in the same session refuses
  to proceed if the file changed on disk and says nothing was written. `delete` records the path it
  removed as absent, so a recreated file is stale for both `write` and `edit` while a symlink's target
  is not marked. A failed edit or write puts the record back, so a later mutation still refuses. Ranged
  reads record nothing and leave an earlier full-file record in place, and every mutation holds the
  per-file queue from the read through the verification. `apply_patch` holds the queues for every file
  it touches for the whole operation.
- **Search results stay in bounds.** Every hit is resolved to its canonical path and must stay inside
  the workspace or a directory the caller named explicitly. A symlink cannot pull outside content into
  `grep`, `find`, or `ls`, and a search rooted at a workspace path that resolves outside is refused the
  way `read` of that path is. Allowlist mode authorizes the canonical target, not the link name.
- **Every mutation is verified.** `write`, `edit`, `apply_patch`, `save_resource`, and `web_fetch`
  saving to disk re-read the file, compare digests inside the locked section, and report a failure when
  the bytes on disk differ. Check-and-write pairs such as `save_resource`'s overwrite guard run inside
  that same section, so two concurrent calls cannot both pass the check.
- **Caps are explicit.** Search keeps 2000 results, stops ripgrep at its output cap or 8 MiB, and cuts
  a matched line at 500 characters, each with a notice, including when the cap leaves no results. An
  `offset` past the 2000-result window is refused rather than silently clamped, and a capped search says
  its totals cover only the matches seen. Output truncation in `bash` keeps the last
  2000 lines or 50KB and spills the full output to a file.
- **Time budgets return partial results.** `grep` and `find` default to 25 seconds and return what
  they have, marked `timedOut` in the details, when the budget expires.
- **Commands are analyzed, not trusted.** Exec rules see each segment with quoting removed, backslash
  line continuations joined, ANSI-C escapes (`$'\x73ecret'`) decoded, leading assignments stripped
  (`PATH=/usr/bin cmd`), and the flags of the wrappers this layer unwraps (`env`, `command`, `nohup`,
  `time`, `exec`, `builtin`, `timeout`, `nice`, `stdbuf`, `setsid`). Reserved words (`if`, `for`,
  `while`, `case`, `!`, braces) are skipped so a rule sees the body, `--` is skipped before `sh -c` and
  `eval` bodies, and a `cd` target resolves `~`, `~currentuser`, `$HOME`, `$PWD`, and `$OLDPWD`.
  Anything the analyzer cannot vouch for is refused before it runs, because the policy cannot see what
  it would execute: a command word built by an expansion, an unquoted command substitution or backtick
  anywhere in the command (including a here-string, `${...}`, and `$((...))`), brace expansion, an
  unresolvable `cd` target such as `~otheruser`, an inline `BASH_ENV`, `ENV`, `CDPATH`, `IFS`, or
  `PS4` (including after `env`, `export`, `declare`, `typeset`, or `readonly`), an alias definition, a
  `trap` with an action, a git `-c` value that starts a shell command or names a command key such as
  `core.fsmonitor` or `diff.external`, `GIT_CONFIG_*` or `GIT_EXTERNAL_DIFF` in the command
  environment, `printf -v` of one of those names, an unquoted glob in a path operand, a recursive
  `grep` or a directory-walking `rg`/`ag`/`ack`, a wrapper that runs another command (`sudo`, `doas`,
  `su`, `runuser`, `xargs`, `find -exec`, `env -S`, `git bisect run`, `flock`, `arch`, `xcrun`,
  `unshare`, `setarch`, `busybox`, `nsenter`, `docker`, `podman`, `ssh`, `caffeinate`, `strace`,
  `bwrap`, and similar), `git grep`, `git checkout-index`, `git fast-export`, a raw-object or batch
  `git cat-file`, `patch`, and `git apply` (each chooses the files or objects it reads or writes), a
  login shell that would source a profile, a shell or interpreter fed a script through a pipe or a
  stdin redirect, and a shell function definition. Literal
  path operands and redirection targets are matched against read and write deny rules and against
  the ignore files, and a write to a protected ignore file is refused. Git literal operands are
  deny-checked too, an index pathspec such as `:file` and a revision path such as `HEAD:file` are
  checked as the files they open, a directory-wide stage (`git add -A`, `-u`, `.`) and `git commit -a`
  are refused because the layer cannot see the staged files, `git log --patch` and `git show` are
  refused unless a path that cannot name a directory narrows them or a summary flag replaces the
  bodies, the destination of `git mv` is a write, and `git init --template` is refused because the
  template installs a hook. `git -C`, `--git-dir`, and
  `--work-tree` outside the workspace need approval, a git destination (`init` and
  `--separate-git-dir`, `archive -o`, `show`/`log`/`diff` `--output`, `clone`, `worktree add`,
  `format-patch -o`, `bundle create`) is a write, the last operand of `git mv` is a write, and a `git config` with a key and a value is refused even when a read flag is
  present, because it can persist a command. A redirect target ends at the next `<` or `>`, `>|` is one
  redirect, and digits stay with the word or file name around a redirect rather than becoming a file
  descriptor. A write-like command (`touch`, `mkdir`, `cp`, `mv`, `rm`, `dd`, `ln`, `tee`, `chmod`,
  `chown`, `truncate`, `install`, `sed -i`, `perl -i`, `unlink`, `rmdir`, `shred`, `ditto`, `zip`,
  `gzip`, `gunzip`, `bzip2`, `xz`, `split`, `openssl -out`, `unzip -d`, a `sed` `w`/`W` script or
  `s///w` flag, `find -delete` and `-fprint`, `tar -C`/`-f`, `curl -o`/`-D`/`-c`/`--trace`, `wget -O`,
  `sort -o`, `uniq`/`xxd`'s second operand, `rsync`'s destination and `--log-file`) or a `>`/`>>`/`>|`
  target outside the workspace needs the same approval as `write`; `split` reads its input and writes
  its prefix, `curl -K` is refused
  because its config names outputs and URLs, `cp`/`mv`/`ln` destination flags such as `-t` and
  `--target-directory` count as the destination, and every `ln` target counts because a link is the
  path a later use escapes through.
  `/dev/null` is a discard sink, so a redirect there carries no outside-write approval. Every spawned
  shell drops `BASH_ENV`, `ENV`, `CDPATH`, `PS4`, `SHELLOPTS`, `BASHOPTS`, and exported functions,
  then pins `PWD` and `OLDPWD` to the working directory. Allowlist mode
  requires every segment to be allowed. A `cd` to a directory outside the workspace needs approval.
  Code a scanner cannot see, such as a script invoked by name, another interpreter's `-c` string, or a
  path built by a variable, is out of reach.
- **A file with more than one name is refused.** A hardlink is a second directory entry for one
  inode, so the other name bypasses path-based deny, ignore, and allowlist rules. The tools refuse to
  read, write, edit, or delete a regular file whose `nlink` is greater than one, and search drops it
  from results. Files materialized as hardlinks by a package manager or dedupe tool are unreadable
  through the layer until they are copied to a single-link file.
- **Patches validate before writing.** All touched files are locked, then every file is read and every
  hunk checked before the first write, so a failure on the second file leaves the first untouched. A
  write that still fails while applying restores every file the patch already changed and removes the
  files and directories it created, so the call keeps its "nothing was written" contract. Untouched
  lines keep their own endings, added lines use the file's dominant ending, and a changed last line
  gains a newline unless the diff carries the no-newline marker. A unified hunk counts its old and new
  lines, so a `---` line inside an open hunk is a removed line and a short hunk is refused. A move
  with no hunks copies the exact bytes, including a binary file, and a patch that rewrites a file
  which is not valid UTF-8 is refused. A move whose destination already exists is refused. Duplicate
  add sections concatenate their lines. Delete hunks must remove the whole file, hunks apply in file
  order and honor zero-context insertions, git-style headers are honored, a hunk-less move and a
  `git diff -M` rename both rename the file, and a no-op, including a patch with no file sections, is
  refused.
- **Errors reach the model as error results.** A failing tool returns `isError` with a message, a hint
  when there is one, and typed details; Pi never sees a thrown error from the layer, so one failure does
  not abort a batch.
- **Bad arguments are repaired before validation.** `file_path`/`filePath`/`directory` map to `path`,
  `old_string`/`new_string` to `oldText`/`newText`, JSON-string arrays become arrays, single objects
  become one-element arrays, and numeric or boolean strings are coerced. Anything still invalid gets
  Pi's validation error with the received arguments.

## Concurrency

Tool calls run in parallel, as in Pi. Every mutation goes through `withFileMutationQueue` on the
resolved target, so two calls that touch the same file serialize instead of clobbering each other.
`search_tools` runs sequentially because it changes the active tool set.

## Security notes

- Extensions run with the host's permissions. The policy is a guardrail against accidental damage, not
  a sandbox. Use a container or VM when the process itself is untrusted.
- Deny rules are checked before any filesystem operation, and the ignore set is re-read at the start of
  every turn, so a `.piignore` the agent writes takes effect on the next turn.
- The layer never runs a command through a shell string it built itself: `git` and `save_resource` use
  `pi.exec` or `writeFile` directly. `bash` runs the exact string the model supplied, behind the exec
  rules.
- Web egress is never implicit. Either a read rule allows the URL, the mode is `unrestricted`, or the
  user approves the call.

## Development

```bash
bun install
bunx vitest run              # unit, integration, and CLI end-to-end suites
bunx vitest run --coverage   # 80% thresholds
PI_TOOLS_LIVE=1 bunx vitest run test/live-model.test.ts   # opt-in real provider
bunx tsc --noEmit -p tsconfig.json
bunx biome check . --error-on-warnings
```

The end-to-end suite runs the real `pi` binary against an isolated profile and workspace with a
deterministic fake model server, so it exercises the CLI, loader, agent loop, and tools without an LLM or
API cost. See [docs/testing.md](docs/testing.md).

See [docs/parity.md](docs/parity.md) for the capability matrix and
[docs/verification.md](docs/verification.md) for the recorded evidence.
