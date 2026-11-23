# Read-only isolation

A read-only subagent must not write files, mutate Git state, or start repository-configured helper programs.

## Sub-features

- Read-only agent frontmatter and `task` `readonly: true`
- Shell command allowlist for reads and repository inspection
- macOS `sandbox-exec` write boundary with a per-command temp directory
- Git helper neutralization for diff drivers, textconv, filters, SSH, credentials, signers, and remote helpers
- Tool allowlists and scoped MCP tools
- Typed refusal for write tools and mutating commands

## How to get to it (user POV)

Set `readonly: true` in an agent file or pass it on `task`:

```markdown
---
name: auditor
description: Reads code without changing it.
tools: read, grep, bash
readonly: true
---
Inspect the code and report findings. Do not modify anything.
```

Ask the auditor to inspect a file. It can read and run allowed commands. A write, redirect, mutating Git command, or MCP write tool is blocked with the read-only error.

## Driving it with the real harness

```bash
cd "$(git rev-parse --show-toplevel)/extensions/no-ceilings/pi-subagents"
node test/e2e/verify-git-helpers.mjs
node test/e2e/verify-crafted-tools.mjs
node test/e2e/verify-readonly-commands.mjs
```

`verify-git-helpers.mjs` builds real repositories with diff drivers, textconv, filters, fsmonitor, SSH, credential helpers, signed commits, man viewers, upload-pack, proxy, and `ext::` remotes. It calls `sandboxReadOnlyCommand` and asserts no secret appears and no marker file is written. `verify-crafted-tools.mjs` launches a real read-only child with a crafted `tools` list and asserts no write or bash tool was granted and no file was created. `verify-readonly-commands.mjs` checks quoted, escaped, and encoded non-Git options, including sort compressors and lesskey startup.

Expected signals:

```text
PASS: repository git helpers did not expose their output or write markers
PASS: modifier-only tools list granted no write tools
```

## Gotchas

- The Git tests call the wrapper directly. A guard change must also block at `isSafeReadOnlyCommand`; test both.
- On macOS the sandbox is the write boundary. Off macOS the command guard is heuristic; do not claim OS enforcement there.
- `git status --help` and `git remote show` are intentionally rejected. Use `git remote -v`, `git branch`, `git tag`, and the other inspection commands.
- The tests use a secret string and markers. A `LEAK false` with a non-zero exit is a pass; a blocked command with the secret in output is not.
- Read-only is a floor: `readonly: false` on a resume does not clear an earlier read-only run.
