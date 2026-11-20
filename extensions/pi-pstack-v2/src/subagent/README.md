# Subagent Example

Delegate tasks to specialized subagents with isolated context windows.

## Features

- **Isolated context**: Each subagent runs in a separate `pi` process
- **Streaming output**: See tool calls and progress as they happen
- **Parallel streaming**: All parallel tasks stream updates simultaneously
- **Markdown rendering**: Final output rendered with proper formatting (expanded view)
- **Usage display**: Shows turns, tokens, cost, and context usage inside each subagent result
- **Abort support**: Ctrl+C propagates to kill subagent processes
- **Live background progress**: with a UI, running wake jobs show in Pi's status line and a widget (`pstack-subagent`): `<id> <agents> <turns>t <n> tools <tokens> tok`. Updates are throttled to 500 ms (5 s past 20 jobs), flushed at job start and end, and cleared when the last job ends or is stopped.
- **Persistent `.output` logs**: each wake job writes JSONL (`start`, one `message` line per worker message, `final`) to `<agent dir>/pstack-v2/subagents/<id>.output` (dir `0700`, file `0600`, capped at 32 MiB). The launch text and the wake report end with `Output file: <path>`.
- **`report_findings` tool**: records structured review findings (`level`, up to 32 `findings` with `file`, `line`, `summary`, `short_summary` ≤ 60 chars, `failure_scenario`, `category`, `verdict` CONFIRMED/PLAUSIBLE, `outcome` fixed/skipped/no_change_needed). The payload is kept in the result `details`, and the TUI draws the count, level and one line per finding (failure scenarios when expanded).

## Structure

```
subagent/
├── README.md            # This file
├── index.ts             # The extension (entry point)
├── agents.ts            # Agent discovery logic
├── agents/              # Sample agent definitions
│   ├── scout.md         # Fast recon, returns compressed context
│   ├── planner.md       # Creates implementation plans
│   ├── reviewer.md      # Code review
│   └── worker.md        # General-purpose (full capabilities)
└── prompts/             # Workflow presets (prompt templates)
    ├── implement.md     # scout -> planner -> worker
    ├── scout-and-plan.md    # scout -> planner (no implementation)
    └── implement-and-review.md  # worker -> reviewer -> worker
```

## Installation

From the repository root, symlink the files:

```bash
# Symlink the extension (must be in a subdirectory with index.ts)
mkdir -p ~/.pi/agent/extensions/subagent
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/index.ts" ~/.pi/agent/extensions/subagent/index.ts
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/agents.ts" ~/.pi/agent/extensions/subagent/agents.ts

# Symlink agents
mkdir -p ~/.pi/agent/agents
for f in packages/coding-agent/examples/extensions/subagent/agents/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/agents/$(basename "$f")
done

# Symlink workflow prompts
mkdir -p ~/.pi/agent/prompts
for f in packages/coding-agent/examples/extensions/subagent/prompts/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/prompts/$(basename "$f")
done
```

## Security Model

This tool executes a separate `pi` subprocess with a delegated system prompt and tool/model configuration.

**Project-local agents** (`.pi/agents/*.md`) are repo-controlled prompts that can instruct the model to read files, run bash commands, etc.

**Default behavior:** Only loads **user-level agents** from `~/.pi/agent/agents`.

To enable project-local agents, pass `agentScope: "both"` (or `"project"`). Only do this for repositories you trust.

When running interactively, the tool prompts for confirmation before running project-local agents unless the session trust context reports trusted and the agents come from that session project's `.pi/agents` directory. Agents loaded from another task `cwd` still require confirmation. Set `confirmProjectAgents: false` to disable confirmation.

## Usage

### Single agent
```
Use scout to find all authentication code
```

### Parallel execution
```
Run 2 scouts in parallel: one to find models, one to find providers
```

### Chained workflow
```
Use a chain: first have scout find the read tool, then have planner suggest improvements
```

### Workflow prompts
```
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

## Tool Modes

| Mode | Parameter | Description |
|------|-----------|-------------|
| Single | `{ agent, task }` | One agent, one task |
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently (max 8, 4 concurrent) |
| Chain | `{ chain: [...] }` | Sequential with `{previous}` placeholder |

## Output Display

**Collapsed view** (default):
- Status icon (✓/✗/⏳) and agent name
- Last 5-10 items (tool calls and text)
- Usage stats: `3 turns ↑input ↓output RcacheRead WcacheWrite $cost ctx:contextTokens model`

**Expanded view** (Ctrl+O):
- Full task text
- All tool calls with formatted arguments
- Final output rendered as Markdown
- Per-task usage (for chain/parallel)

**Parallel mode streaming**:
- Shows all tasks with live status (⏳ running, ✓ done, ✗ failed)
- Updates as each task makes progress
- Distinguishes pending, running, completed, failed, and aborted tasks
- Returns each completed task summary to the parent model with its own 50 KB limit
- Returns failure diagnostics from stderr/error messages when a child exits before producing output

**Tool call formatting** (mimics built-in tools):
- `$ command` for bash
- `read ~/path:1-10` for read
- `grep /pattern/ in ~/path` for grep
- etc.

## Agent Definitions

Agents are markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: claude-haiku-4-5
---

System prompt for the agent goes here.
```

When `model` is omitted, the subagent inherits the dispatching session's active model and thinking level.

Optional frontmatter:
- `disallowedTools: bash, write` removes tools from `tools` (or from every built-in tool when `tools` is absent). `*` is ignored. When nothing is left the child starts with `--no-tools`.
- `omitContextFiles: true` starts the child with `--no-context-files`.
- `skills: a, b` appends each skill's `SKILL.md` body (frontmatter stripped) to the child's system prompt. Searched in `<cwd>/.pi/skills`, `<cwd>/.agents/skills`, the Pi agent dir `skills`, `~/.agents/skills`, then this package's `skills`. At most 32; missing skills are skipped.
- `maxTurns: 20` stops the child after that many assistant turns. The call still counts as completed, with `stopReason: "max_turns"`.
- `memory: user | project | local` gives the agent a persistent directory (`<agent dir>/agent-memory/<name>`, `.pi/agent-memory/<name>`, or `.pi/agent-memory-local/<name>`, created `0700`). Its `MEMORY.md` (first 200 lines or 25000 characters; never a symlink) is added to the system prompt. With a restricted `tools` list, `read`, `write` and `edit` are added. The `user` scope also sets `PI_SUBAGENT_MEMORY_DIR` so the child's Gondolin VM mounts that directory writable at its host path.
- `isolation: worktree` (or `isolation: "worktree"` on a call, task or chain step) runs the child in `.pi/worktrees/subagent-<name>-<hex>` on branch `worktree/<slug>`. A worktree with no changes and no commits is removed on exit. Otherwise it is kept, and the report ends with `Worktree kept: <path> (branch <branch>)`.

## Fork subagents

`agent: "fork"` is built in. The child continues a temp copy of the parent session (`--session`), with the parent's model, thinking level and system prompt, so it reuses the parent's prompt cache. Tool calls the parent left open get synthetic results. A fork cannot fork again (`PI_SUBAGENT_IS_FORK=1`, or the fork boilerplate on the parent branch), and `PI_SUBAGENT_FORK_DISABLED=1` or `true` turns forks off.

## Safety limits

Every report (single, parallel, chain, wake) opens with an untrusted-output banner, since it is model output with no user authority, and ends with a `<usage>` block when any turn ran.

Each child gets `PI_SUBAGENT_DEPTH` one higher than its parent's. A call is refused when the depth is at `PI_SUBAGENT_MAX_DEPTH` (default 3). A call is also refused when its workers would take the session past `PI_SUBAGENT_MAX_CONCURRENT` (default 20) running at once, woken jobs included.

**Locations:**
- `src/subagent/agents/*.md` - Bundled with this package (every scope)
- `~/.pi/agent/agents/*.md` - User-level (with `agentScope: "user"` or `"both"`)
- `.pi/agents/*.md` - Project-level (only with `agentScope: "project"` or `"both"`)

User agents override bundled agents with the same name, and project agents override both.

## Sample Agents

| Agent | Purpose | Model | Tools |
|-------|---------|-------|-------|
| `scout` | Fast codebase recon | Haiku | read, grep, find, ls, bash |
| `planner` | Implementation plans | Sonnet | read, grep, find, ls |
| `reviewer` | Code review | Sonnet | read, grep, find, ls, bash |
| `worker` | General-purpose | Sonnet | (all default) |

## Workflow Prompts

| Prompt | Flow |
|--------|------|
| `/implement <query>` | scout → planner → worker |
| `/scout-and-plan <query>` | scout → planner |
| `/implement-and-review <query>` | worker → reviewer → worker |

## Error Handling

- **Exit code != 0 or signal termination**: Tool returns an error with preserved stderr/output
- **Spawn errors**: Tool returns the spawn diagnostic
- **stopReason "error"**: LLM error is propagated with its error message
- **Abort**: Ctrl+C sends SIGTERM, escalates to SIGKILL after five seconds if needed, and preserves partial details/usage
- **Chain mode**: Stops at the first failing step and reports which step failed

## Limitations

- Output truncated to last 10 items in collapsed view (expand to see all)
- Single and chain output is capped at 50 KB/2,000 lines; full results remain in tool details
- Parallel output keeps a separate 50 KB budget per task, allowing up to roughly 400 KB across eight tasks
- Child usage is displayed in tool details but is not added to the calling session's usage totals
- Agents are snapshotted from each task's effective cwd when the tool invocation starts; relative task cwd values resolve from the session cwd
- Parallel mode limited to 8 tasks, 4 concurrent
