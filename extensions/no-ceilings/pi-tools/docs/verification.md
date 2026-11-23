# Verification

Recorded on 2026-11-23 against Pi 1.6.0 on macOS arm64. Each run used an isolated profile
(`PI_CODING_AGENT_DIR=/tmp/pi-tools-verify/agent`) and a throwaway workspace, with the extension loaded
from source through `-e`.

## Deterministic checks

```
bunx tsc --noEmit -p tsconfig.json          # no output, exit 0
bunx vitest run                             # 28 files passed, 1 skipped; 409 passed, 1 live test skipped
bunx vitest run --coverage                  # statements 89.93, branches 83.41, functions 95.16, lines 89.87
bunx biome check . --error-on-warnings      # no diagnostics
```

## Live run 1: read metadata and content search

```
pi --print --model deepseek-flash \
  --tools read,grep,find,ls,write,edit,bash \
  -e extensions/no-ceilings/pi-tools/src/index.ts \
  "Read hello.txt with the read tool, then search the workspace for the word needle with the grep
   tool. Reply with exactly two lines: first the [file: ...] line from the read result, second the
   grep match line for hello.txt. Do not use bash."
```

Observed:

```
[file: 3 lines, 36 bytes]
hello.txt:2: line two needle
```

Proves the `read` override (metadata footer, line count, byte count) and the `grep` override (path,
line number, matched line) both run through Pi's tool pipeline.

## Live run 2: ignore file and permission rule

Workspace held `hello.txt`, `secret.txt`, `sub/deep.txt`, all containing `needle`, plus `.piignore`
with `sub/` and a config denying `read **/secret.txt`.

```
pi --print --model deepseek-flash --tools read,grep,... \
  "Search the current directory for the word needle with the grep tool. Then try to read secret.txt
   with the read tool. Reply with exactly two parts: the list of files grep found, then the read
   tool's error text verbatim."
```

Observed:

```
**Files grep found:**
- `hello.txt`

**read tool error:**
Blocked by permissions configuration (rule: **/secret.txt)
```

Proves `.piignore` filtering (`sub/deep.txt` absent), deny rules applied to search results
(`secret.txt` absent from grep) and to an explicit read.

## Live run 3: write, edit, write, read

```
pi --print --model deepseek-flash --tools read,write,edit,apply_patch,search_tools,bash,ls,find,grep \
  "Step 1: use the write tool to create out/new.txt with exactly the content alpha. Step 2: use the
   edit tool to replace alpha with beta in out/new.txt. Step 3: run the write tool again on
   out/new.txt with exactly the content from a two line file: first line beta, second line gamma.
   Then read out/new.txt and reply with its content and the edit tool's confirmation line."
```

Observed assistant text:

```
Final content of `out/new.txt`:
beta
gamma

Edit tool's confirmation line:
Successfully replaced 1 block(s) in out/new.txt.
(with diff `-1 alpha` / `+1 beta`)
```

Observed file: `beta\ngamma\n`.

## Live run 4: patch tool through the loader

```
pi --print --model deepseek-flash --tools read,write,edit,search_tools,bash,ls,find,grep,apply_patch \
  "target.txt currently contains alpha on line 1 and beta on line 2. Use search_tools with the query
   patch to find the patch tool, then call the tool it loads to change beta to gamma. Reply with the
   patch tool result line and the file's final content."
```

Observed:

```
Patch tool result line:
~ target.txt (1 hunks, +1/-1)

Final content of `target.txt`:
alpha
gamma
```

## Live run 5: dynamic loading of an inactive tool

`git` is registered with `defaultActive: false`. The run used no `--tools` flag.

```
pi --print --model deepseek-flash -e .../src/index.ts \
  "Use search_tools with the query git to load the git tool, then call that git tool with subcommand
   log and args [--oneline,-1]. Reply with the commit line it printed."
```

Observed:

```
0bb1c36 initial commit subject
```

Proves `search_tools` activation through `pi.setActiveTools` and the `git` tool's `pi.exec` path.

## Live run 6: shell working directory and exit status

```
pi --print --model deepseek-flash -e .../src/index.ts \
  "Use the bash tool twice. First call: cwd sub, command pwd. Second call: command 'exit 3'. Reply
   with exactly two lines: the printed directory, then the exact error text from the second call."
```

Observed:

```
/private/tmp/pi-tools-verify/ws6/sub
Command exited with code 3
```

## Native Pi surfaces relied on, not reimplemented

The MCP client, codemode tool discovery, and `tool_search` come from Pi's built-in extensions. They are
enabled by `builtin:mcp`, `builtin:codemode`, and `builtin:tool-search`; the layer's tools are reachable
from `codemode` scripts through `ctx.executeTool` because they are active `direct` tools. No code in this
package implements an MCP transport.

## Post-interrogation fixes

An adversarial pass produced 25 verified findings. Each one has a regression test in
`test/regressions.test.ts`, and these live runs re-checked the security-relevant ones after the fixes.

### Live run 7: symlinks, chained commands, and a direct read

Workspace config: `unrestricted` mode with `read deny **/secret.txt`, `write deny **/secret.txt`, and
`exec deny echo secret*`. `link.txt` is a symlink to `secret.txt`.

```
pi --print --model deepseek-flash -e .../src/index.ts \
  "Do exactly three things with the tools. 1) read link.txt. 2) run the bash command
   'cd . && echo secret-value'. 3) read the file secret.txt directly. Reply with the three error texts
   verbatim, one per line."
```

Observed:

```
Blocked by permissions configuration (rule: **/secret.txt)
Blocked by permissions configuration (rule: echo secret*)
Blocked by permissions configuration (rule: **/secret.txt)
```

Before the fixes this run returned `TOP-SECRET`, printed `secret-value`, and refused only the direct
read.

### Regression matrix

| Finding | Regression test |
| --- | --- |
| `workspaceRoots: ["."]` resolved against home | `finding 1: workspaceRoots resolve against the working directory` |
| Symlink bypass of deny rules and containment | `finding 2: symlinks cannot bypass deny rules or the workspace boundary` |
| Non-canonical containment | `finding 3: containment compares canonical paths` |
| Unified-diff add wrote an empty file | `finding 4: a unified diff add writes the added lines` |
| Failed move deleted the source | `finding 5: a failed move keeps the source` |
| Patch and edit lost updates | `finding 6: patches serialize with edits and with each other` |
| Delete outside the mutation queue | `finding 7: delete serializes with other mutations` |
| `save_resource` overwrite race | `finding 8: save_resource checks overwrite inside the queue` |
| Redirect bypassed a URL deny rule | `finding 9: a redirect cannot bypass a URL deny rule` |
| `web_fetch` ignored abort and body timeout | `finding 10: web_fetch honors abort and timeout for the body` |
| `web_fetch saveTo` skipped ignore rules | `finding 11: web_fetch saveTo honors ignore rules` |
| Ignore model inconsistent across tools | `finding 12: one ignore verdict across search and read` |
| `bash` cwd outside the workspace | `finding 13: a command outside the workspace needs approval` |
| Exec rules evaded by a prefix or chain | `finding 14: exec deny rules apply to every command segment` |
| `git` dropped stdout on a non-zero exit | `finding 15: git keeps stdout when it exits non-zero` |
| Grep misparsed line-like text | `finding 16: grep parses a match whose text contains a line-like token` |
| CRLF `oldText` never matched | `finding 17: an edit matches CRLF text copied from read` |
| Context-only patch appended a newline | `finding 18: a context-only patch on a file without a final newline is a no-op` |
| Argument repair only on `edit` | `finding 19: documented argument aliases work on every path tool` |
| Grep cap reported "No matches found" | `finding 20: grep reports the cap instead of no matches` |
| Patch counts wrong for insertions | `finding 21: patch counts report one insertion as +1/-0` |
| Negative range in the metadata footer | `finding 22: a tail read reports its real line range` |
| Failed edit created a directory | `finding 23: a failed edit leaves no directory behind` |
| Source named the process behind the inventory | `docs > no shipped source names the process behind the inventory` |
| Docs contradicted the tree | `docs > every `suite > test` citation in the parity matrix names a real test`, `the parity matrix names only files that exist` |

## Second adversarial pass

A second pass produced 20 verified findings. Each has a regression in `test/regressions2.test.ts`. The
fixes are grouped by root cause.

| Finding | Regression |
| --- | --- |
| Search escaped the workspace through symlinks | `finding 1: search cannot leave the workspace through a symlink` |
| Allowlist matched a link name and authorized its target | `finding 2: an allowlist match on a symlink name does not authorize its target` |
| Patch wrote earlier files before a later failure | `finding 3: a patch that fails later writes nothing` |
| Unified-diff delete skipped hunk validation | `finding 4: a unified-diff delete validates the removed lines` |
| Blank line between unified sections truncated the patch | `finding 5: a blank line between unified-diff sections does not truncate the patch` |
| Git-style multi-file diff was rejected | `finding 6: a git-style multi-file diff is accepted` |
| No-newline marker was discarded | `finding 7: the no-newline marker is honored` |
| Later hunks matched earlier copies | `finding 8: hunks apply in file order` |
| Failed patch created directories | `finding 9: a failed patch creates no directories` |
| Pure move was refused as a no-op | `finding 10: a pure move renames without a content change` |
| Exec rules missed ordinary spellings | `finding 11: exec rules cover ordinary command spellings` |
| One matching segment authorized a whole command | `finding 12: allowlist mode requires every command segment to be allowed` |
| `cd` escaped the workspace gate | `finding 13: a cd inside the command respects the workspace boundary` |
| `web_search` followed redirects ungated | `finding 14: web_search gates every redirect hop` |
| Userinfo URL bypassed a host rule | `finding 15: a userinfo URL cannot bypass a host deny rule` |
| Mixed-EOL edits rewrote untouched lines | `finding 16: an edit preserves untouched line endings` |
| Read footer reported impossible ranges | `finding 17: the read footer reports a truthful range` |
| Grep clamped offsets silently | `finding 18: grep pagination is bounded and honest` |
| Docs overclaimed | `finding 19: docs and tools match their claims` plus the docs tests |
| Concurrent-patch claim exceeded its test | `finding 20: concurrent patches serialize and no reported success is lost` |

### Live run 8: symlinked search and a nested shell

Workspace contains `inside.txt` with a match, a symlink `escape.txt` to a match outside the workspace,
a symlink directory `escape-dir` to that outside directory, and a deny rule for `echo secret*`.

```
pi --print --model deepseek-flash -e .../src/index.ts \
  "Do two things with the tools. 1) grep the current directory for the word needle. 2) run the bash
   tool with exactly this command: sh -c 'echo secret-value'. Reply with the grep output and the bash
   error text verbatim."
```

Observed:

```
1) grep output (verbatim):
inside.txt:1: inside needle

2) bash error text (verbatim):
Blocked by permissions configuration (rule: echo secret*)
```

Before the fixes, the same workspace returned the outside file through both symlinks, and the nested
shell printed the secret.
