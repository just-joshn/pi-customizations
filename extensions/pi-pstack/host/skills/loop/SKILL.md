---
name: loop
description: Run a prompt or skill in this Pi session on a fixed or self-paced interval, or on a watched event, through monitored background shell output. Use for /loop, "/loop 5m /foo", "check X every 10 minutes", "loop until done", or a playbook that arms a terminal /loop tick.
disable-model-invocation: true
---

# Loop

Pi port of Reference's local `/loop`. A background shell prints a sentinel line. `BackgroundShell` with `notify_on_output` turns each matching line into a wake message that starts your next turn. Cloud timers do not exist here. If a workflow requires a cloud wake chain, stop at that gate and say so.

## Parse

Accept `/loop [interval] <prompt>`.

- Leading interval: `5m /foo`, `30s check status`, `2h run report`.
- Trailing interval: `check deploy every 5m`, `run tests every 10 minutes`.
- No interval: dynamic mode. You choose each delay.
- Empty prompt: reply `Usage: /loop [interval] <prompt>` and stop.

Normalize to `s`, `m`, `h`, or `d`, then to seconds. Cron phrases have no local mechanism. Convert one to a delay and say so.

Pick a short `<purpose>` slug from the prompt, such as `check-deploy`. Every sentinel for this loop starts with it.

## Fixed schedule

1. Call `BackgroundShellList`. If a running shell already prints this loop's sentinel, do not start another.
2. Call `BackgroundShell` with title `Loop every <interval>: <prompt>`, `notify_on_output: "^AGENT_LOOP_TICK_<purpose>"`, and this command:

   ```bash
   while true; do
     sleep <seconds>
     echo 'AGENT_LOOP_TICK_<purpose> {"prompt":"<prompt>"}'
   done
   ```

3. Run the prompt once now. The first tick arrives only after the first sleep, so startup never runs it twice.
4. Confirm the interval, that the prompt already ran, when the first tick lands, and that it repeats until stopped. Record the shell id.

## Dynamic schedule

1. Run the prompt now.
2. If the next run waits on an event (a ref advancing, a log line, a file change, a CI check), start one watcher with `BackgroundShell` that prints `AGENT_LOOP_WAKE_<purpose> {"prompt":"<prompt>"}` only when the event fires, with `notify_on_output: "^AGENT_LOOP_WAKE_<purpose>"`. Skip this on later ticks while the watcher still runs. A watcher subagent through `Task` in the background also wakes you on completion.
3. At the end of each turn, start a one-shot heartbeat with the same pattern:

   ```bash
   sleep <seconds>
   echo 'AGENT_LOOP_WAKE_<purpose> {"prompt":"<prompt>"}'
   ```

   With a watcher, this is the fallback, so lean long. Without one, it is the cadence. Size it to when the result is worth checking again.
4. On wake, act on the prompt in the latest matching line, then start the next heartbeat. Restart the watcher only if it exited. If a watcher wake and a heartbeat wake both arrive, act once.
5. Confirm that you self-pace, whether a watcher is the primary signal, and the fallback delay.

## Payload

A wake message names the output file and the matching line. Put the prompt beside the sentinel as JSON so it can change from tick to tick. While one wake waits in the queue, later matches from the same shell are counted but not sent, so a slow turn never builds a backlog. When the line is cut short or the prompt varies, act on the last matching line in the output file.

## Stop

Call `BackgroundShellStop` for the loop's shell and for any watcher. Do not start another heartbeat. Say the loop stopped and why. If several shells match the purpose and you cannot tell which one the user means, list them and ask.

## Limits

- Shells live only as long as this Pi session. Quitting, `/reload`, or switching sessions stops every loop. Re-arm after a restart.
- Use a unique sentinel per loop. Keep the loop quiet apart from the sentinel.
- A nonzero exit from a shell also wakes you. Treat it as a failed watcher and re-arm or report it.
