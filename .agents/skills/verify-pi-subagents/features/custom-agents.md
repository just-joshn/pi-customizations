# Custom agents

Project and user Markdown files with YAML frontmatter become selectable subagents.

## Sub-features

- Discovery from `.pi/agents`, `.claude/agents`, `.codex/agents`, and `.agents/agents`
- User directories under the same names in the home agent directory
- Frontmatter for `name`, `description`, `tools`, `model`, `thinking`, `readonly`, `worktree`, `background`, `nested-tasks`, `retry`, and `enabled`
- Project precedence over user definitions and case-insensitive name deduplication
- Project trust gate and symlink-resolved configured directories
- `/agents` catalog and `/subagent:<slug>` invocation

## How to get to it (user POV)

Create a project agent:

```bash
mkdir -p .pi/agents
cat > .pi/agents/probe.md <<'MARKDOWN'
---
name: probe
description: Runs one shell command and reports its stdout verbatim.
tools: bash
---
You run exactly the shell command you are given and report its stdout verbatim.
MARKDOWN
pi --approve -e "$(git rev-parse --show-toplevel)/extensions/no-ceilings/pi-subagents/src/index.ts"
```

Run `/agents` in the session. The catalog should include `probe`. Invoke it with `/subagent:probe <prompt>` or ask the parent to delegate to `subagent_type: "probe"`.

## Driving it with the real harness

```bash
cd "$(git rev-parse --show-toplevel)/extensions/no-ceilings/pi-subagents"
node test/e2e/verify-subagents.mjs
```

The script writes `.pi/agents/probe.md` with `tools: bash`, initializes a git repository, and uses the real `pi` binary with the real model (default `deepseek-flash`). It runs a foreground `probe` call, a background `probe` call with `worktree: true`, and `await_subagent`.

Expected signals:

```text
ok foreground subagent returned its shell output
ok background subagent ran on pi-subagents/<slug>-<3 hex>
ok git lists the isolated worktree
ok child transcripts written to .../sessions/subagents
PASS /tmp/pi-subagents-e2e-...
```

If no model credential is configured, the script exits `77` and prints a skip. Do not treat that as a passing drive.

The deterministic alternative is the `delegation` scenario. It already uses a custom `worker` agent, but only with the `read` tool.

## Gotchas

- Project agents do not load on an untrusted project. Use `--approve` or trust the workspace.
- `tools: bash` is explicit. Omit `tools` to inherit the parent's active tools; use `tools: []` to grant none.
- The real-model script depends on network and credentials. Its evidence is still the parent session and child transcripts, not the model's wording.
- The temp workspace is a git repository because the worktree run requires one. Do not replace it with a plain directory.
- Model ids in agent frontmatter can be provider-qualified. The harness's default model is not a product default.
