# Delegation

The parent uses the `task` tool to start one child `AgentSession`, then reports the child result.

## Sub-features

- `task` foreground call with `description`, `prompt`, and `subagent_type`
- Automatic agent selection when `subagent_type` is omitted
- Child result and final message returned to the parent
- `/subagent:<slug> [--bg] <prompt>` for an explicit named agent
- `/agents` to list discovered agents and the effective config
- Retry and failure details on the parent result

## How to get to it (user POV)

Open Pi with the extension loaded from source:

```bash
cd "$(git rev-parse --show-toplevel)/extensions/no-ceilings/pi-subagents"
pi -e ./src/index.ts
```

Ask for work in natural language. The parent model calls `task`, for example with `subagent_type: "explore"` or a discovered project agent. The result returns in the parent conversation. Use `/agents` to see the catalog and `/subagent:worker ...` to bypass model selection.

A project agent is available only after the project is trusted with `--approve` or `defaultProjectTrust`.

## Driving it with the real harness

```bash
cd "$(git rev-parse --show-toplevel)/extensions/no-ceilings/pi-subagents"
node test/e2e/verify-delegation-fake-model.mjs
```

The script creates a temp workspace, writes `.pi/agents/worker.md` with `tools: read`, starts a fake OpenAI-compatible model, and launches the real `pi -p` with the extension. The parent request produces a real `task` call; the child runs the real `read` tool on `marker.txt`; the parent receives the result.

Expected signal:

```text
ok parent reply contains PARENT_SAW:CHILD_SAW:deterministic-marker-5f31
PASS /tmp/pi-subagents-fake-e2e-...
```

The script also asserts four model requests, two child turns, a parent session with a `task` call, a child transcript containing the `read` call and marker, and a persisted `success` record with a transcript path.

Inspect the printed root:

```text
<root>/workspace/sessions/*.jsonl
<root>/workspace/sessions/subagents/*.jsonl
```

## Gotchas

- The fake model always chooses the custom `worker` agent and the `read` tool. It cannot verify a different agent description or a different tool.
- The workspace must contain `.pi/agents/worker.md`; the script writes it. A test that forgets the file fails with `type-unknown`.
- The parent reply alone is not proof. Check the child transcript for the tool call and the marker, and the parent session for the persisted record.
- `/subagent` and `/agents` are TUI commands. The headless script exercises the `task` tool; use the TUI recipe in `observability-tasks.md` for the command surface.
- Exit code `77` is reserved for a missing real model, not for the deterministic delegation script.
