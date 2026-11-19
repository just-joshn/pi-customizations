# Pi worker delegation

Users delegate standalone tasks to separate Pi processes through the `subagent` tool and receive their reports, either when the call returns or, with `wake`, as a message after the call has returned.

## Sub-features

- `worker-report`: a single call (`agent` + `task`) returns a real worker's completed answer.
- `worker-modes`: `tasks` runs up to 8 workers, 4 at a time; `chain` runs steps in order with `{previous}` replaced by the last step's output; a call with no mode or two modes is refused.
- `worker-agents`: bundled agents `worker` (every editing tool, no role prompt), `scout` (no edit or write tool), `poteto-agent`, `comment-sicko`, `ci-watcher`, `thermo-nuclear-code-quality-review`; an unknown name lists the available agents.
- `worker-model`: a call's `model` and `thinking` override the agent's and the session's.
- `worker-wake`: with `wake`, the call returns `Started subagent job subagent-<6 hex>.` at once, and the report arrives later as a `pstack-subagent` message.
- `worker-stop`: `stop: "<job id>"` aborts a running wake job, whose wake message then says it was aborted.
- `worker-print`: a print-mode Pi waits for its wake jobs before it settles and continues with their reports.
- `worker-nesting`: a worker loads the same extensions, so it can call `subagent` itself.

## How to get to it (user POV)

- Ask Pi to call `subagent` with a standalone brief.
- Use a workflow that delegates, such as poteto-mode, swarm, arena, eval, or a reviewer skill.
- Run native `pi -p` with the isolated profile and resources from command.json for the print-mode entry.

## Driving it with the PTY helper

Preconditions:

- Owner-approved login through a built-in provider, a selected model, and healthy doctor. Workers inherit `PI_CODING_AGENT_DIR`, so they use the scratch profile and its login.
- In scratch work create fixture.txt with the text PSTACK_FIXTURE_42. This is verification input, not an injected result.

- **Report:** send `Call subagent with agent "scout" and task "Read fixture.txt in your working directory with a real tool. Reply with its contents and your working directory. Do not edit files."`. Require one `subagent` call, a report containing PSTACK_FIXTURE_42, and `/workspace` as the worker's directory (its own VM mounts its `cwd`).
- **Modes:** ask for `tasks` with a `scout` and a `worker` reading fixture.txt; require `Parallel: 2/2 succeeded`. Ask for a `chain` whose second step uses `{previous}`; require the final output to reflect step 1. Ask for a call naming `agent` "nope"; require `Unknown agent: "nope". Available agents:` listing the bundled names.
- **Model:** ask for a `scout` call with `model` set to an available `provider/id` other than the session's and `thinking` "low". Require those arguments on the call and that model on the result's usage line.
- **Wake:** ask `Call subagent with agent "worker", task "Run sleep 20 with bash, then reply DONE_SLEEPING", and wake "sleeper finished". Report the job id, then end your turn without calling any other tool.` Require the immediate `Started subagent job …` result, an idle editor while the worker runs, and then, with no new user prompt, a message containing `sleeper finished`, the same job id, and DONE_SLEEPING.
- **Stop:** start the same wake job, then ask `Call subagent with stop set to <the exact job id>.` Require `Stopped subagent job <id>.`, then a wake message for that id whose report says aborted. A second stop with the same id answers `No running subagent job <id>.`
- **Print settle:** run native `pi -p` with the isolated profile/resources and the wake request above, under a bounded external timeout. Require the process to stay alive until the wake report arrives, then exit 0 with output that contains it.
- **Nesting:** ask a `worker` to call `subagent` with `agent` "scout" on fixture.txt and return the nested report. Require the nested report; nothing refuses a second level.
- **Workflow entry:** submit `/skill:poteto-mode Create hello.txt containing HELLO_PSTACK in this disposable repository.`; require its actual `subagent` calls, persisted plan/checklist files, and independently read hello.txt. Direct `subagent` coverage does not cover workflow delegation.

## Gotchas

- A standalone brief must name required fixture paths; workers do not inherit the parent conversation.
- Workers run `pi --no-session` in a private tmux server under `/tmp/pi-subagent-tmux-*`, deleted when they finish. There is no worker session file and no resume; the parent session's `subagent` result or wake message is the record. Preserve the parent session JSONL before cleanup.
- A blocking call holds the parent turn until every worker finishes, and a wake message waits for the parent's running tool call. Do not count a report as a wake if it arrived as the call's own result.
- `scout` has no edit or write tool, but its `bash` can still write. A read-only claim needs an attempted write through the missing tool, not just an unchanged file.
- There is no `readonly`, `worktree`, `base`, `resume`, or `name` parameter. A worktree is created first, for example with `tmux_run` running `git worktree add`, and passed as `cwd`; the empty baseline has no HEAD, so seed a commit before any worktree journey.
- Project agents under `.pi/agents` need `agentScope: "project"` or `"both"`, and an untrusted project asks `Run project-local agents?` first.
- Model/provider errors, missing credentials or rate limits are failures/blockers, not successful worker reports.
- Native workers can discover user `~/.agents/skills` through the inherited `HOME`; review their loaded resources and avoid claiming full resource isolation.
