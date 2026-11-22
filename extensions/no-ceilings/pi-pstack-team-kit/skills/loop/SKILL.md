---
name: loop
description: >-
  Run a prompt or skill in this Pi session on a recurring or variable interval
  (e.g. /skill:loop 5m /skill:foo).
---
# Loop

Run a prompt now and repeat it on a fixed or variable interval. Use Pi's background `task` completion to wake the current session. If `task` and `await_subagent` are unavailable, say so before running the prompt. Do not replace the loop with a goal or a foreground wait. The Pi session must stay open.

## Parse

Accept `/skill:loop [interval] <prompt>`.

- Leading interval: `5m /skill:foo`, `30s check status`, `2h run report`.
- Trailing interval: `check deploy every 5m`, `run tests every 10 minutes`.
- No interval: dynamic mode; the agent chooses the delay and may change it tick to tick.
- Empty prompt: show `Usage: /skill:loop [interval] <prompt>`.

Use intervals like `30s`, `5m`, `2h`, `1d`. Convert unit words to short units. Use only a validated positive number of seconds in the sleeper command. Keep the literal prompt in the current session, not in a shell command or watcher output.

## Fixed Schedule

1. Check for an already-running matching loop. Use a unique name for this loop and track its pending task ID.
2. Start one background `task` with `subagent_type: "shell"` and `run_in_background: true`. Tell it to run a single sleep for the interval, with a Bash timeout longer than the delay, then report completion. It must not run the user's prompt.
3. Run the prompt once immediately. On a successful completion for the current task ID, arm the next sleeper and run the prompt again. Do not start duplicate sleepers or replay missed ticks. A failed or cancelled sleeper is not a tick.
4. Briefly confirm the interval, that the prompt already ran once, when the first tick will arrive, and that the loop repeats until stopped. On later ticks, give a short update of what changed.

## Dynamic Schedule

The user wants the agent to self-pace. Decide what makes the next iteration worth running: a passage of time, or an observable event.

1. **Run the prompt now.**
2. **If the next run is gated on an event** (a git ref advancing, a log line matching, a file changing, a CI check completing), arm a background shell `task` that completes only when the event fires. Arm once; skip on later ticks if it is still running.
3. **At the end of the turn, arm a one-shot time-based wake** as in Fixed Schedule. With a watcher armed, this is the **fallback heartbeat**. Lean long so idle ticks aren't pure overhead. Without a watcher, this is the cadence.
4. **On wake**, match the completion against the tracked IDs. Execute the prompt once for the first successful wake, then choose the next delay. If the watcher is still running, keep it. If the watcher completed, cancel the previous heartbeat before arming another. Ignore stale, duplicate, failed, or cancelled completions.
5. Briefly confirm that you are self-pacing, whether a watcher is the primary wake signal, what fallback delay you picked, and that the prompt already ran.

## Stop

On stop, or when the requested outcome is reached, mark the loop stopped before cancelling any pending watcher or sleeper. Use `/tasks abort <id>` for each tracked pending task. If the command must be entered by the user, show the exact commands. Use `await_subagent` to consume a completed task when needed. Ignore subsequent completions for those IDs and do not schedule another wake. Say the loop has stopped and why.
