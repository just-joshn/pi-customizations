# Task subagents

The model calls `Task` to run a subagent: a child Pi process with its own transcript. In the foreground the parent waits and gets the child's reply with its agent ID. In the background the call returns at once, and when the child finishes a `pstack/task` system notification wakes the parent for a follow-up turn. `agent_status` lists every subagent in the workspace.

## Sub-features

- `task-foreground`: result is `This is the output of the subagent:\n\nresponse:\n<response>\n<reply>\n</response>\n\nAgent ID: <uuid> (can be used with the ...`.
- `task-transcript`: `agent/pstack/workspaces/<slug>/subagents/<timestamp>_<id>.jsonl` holds the child's session, and `<id>.json` its record.
- `task-background`: result starts `Subagent is running in the background. If needed, you can monitor its output by tailing the transcript at: `.
- `task-notice`: a `pstack/task` custom message with `<task>\nkind: subagent\nstatus: success\ntask_id: <id>\ntitle: <first prompt line>\ntool_call_id: <id>\ndetail: <reply>\n</task>`, followed by a parent turn.
- `task-status`: `agent_status` with no args starts `N subagents in this workspace:` and names each ID.

## How to get to it (user POV)

- Ask the agent to delegate; skills like `/poteto-mode`, `/swarm`, `/how` call `Task`.
- Ask "check on my subagents" (`agent_status`).
- In the TUI, the Task card streams child steps; not covered here.

## Driving it with control-pstack

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-pstack/bin/control-pstack drive task-subagents`.
- **Act.** Three JSON runs in the same scratch cwd: `Task {prompt:"go\n@@say PONG-FG", run_in_background:false}`; `Task {prompt:"go\n@@sleep 1500 PONG-BG", run_in_background:true}`; `agent_status {}`.
- **Observe.**
  - Foreground result matches `task-foreground` with `PONG-FG`; the child transcript's only assistant text is `PONG-FG`; the record file exists.
  - Background launch text matches `task-background`; exactly the `task-notice` block arrives with `detail: PONG-BG`; the last assistant text starts `ECHO: <system_notification>`; exit code 0.
  - `agent_status` starts `2 subagents in this workspace:` and lists both IDs.
- **Proof.** `artifacts/verify-pi-pstack/task-subagents/`: `foreground.events.jsonl`, `background.events.jsonl`, `status.events.jsonl`, `results.json`, and `subagents/` (copied transcripts and records).

## Gotchas

- The child also runs `scripted/echo`, so the child's directive goes in the Task `prompt`, on its second line.
- `agent_status` counts every subagent in the workspace, so the count depends on running all three steps in one scratch cwd.
- A JSON run waits for background children before exiting; a hung child shows up as the 60 s timeout, not as a FAIL assertion.
- `resume`, `fork`, `stop_agent`, `readonly`, and cloud environments are not driven here; `test/e2e/task.e2e.test.ts` covers them.
