---
name: loop
description: Run a prompt or skill on a recurring or self-paced schedule. Use for "/loop 5m check deploy", "keep checking X until Y", polling a PR, a build, or a service, or any task that should repeat until stopped.
---

# Loop

Repeat a prompt on a schedule, or pace it yourself, until the work is done or the user stops it.

## Fixed interval

The user runs `/loop <interval> <prompt>`, such as `/loop 5m check deploy`, `/loop every 30s check status`, or `/loop run tests every 10 minutes`. The `/loop` command does the arming. It starts a `tmux_run` timer job named `loop-<purpose>` that prints one sentinel line each interval, and it watches that job's output with `notify_on_output`. It runs the prompt once now, and each tick wakes you with a message that names the sentinel.

- Each wake means one more run of the prompt. Run it, report in a few lines, and end your turn.
- The first tick comes after one full interval, so the immediate run is never doubled.
- A second `/loop` with the same purpose is refused while the first runs.
- `/loop list` shows the running loops. `/loop stop <id|name|all>` stops them, as does `tmux_jobs` `stop` with the job id. A stopped loop sends no further wake.
- Matches that arrive close together are batched at least 5 seconds apart. Fixed `/loop` timers keep firing until stopped; custom `tmux_run` `notify_on_output` watchers cap at 100 matches by default unless `notification_limit` is set.

## Dynamic schedule

The user runs `/loop <prompt>` with no interval, or asks you to keep doing something until a condition holds. You pace the loop.

1. Run the prompt now.
2. Decide what should wake you next.
   - If an event can be watched, such as a log line, a status change, or a file appearing, start a `tmux_run` watcher with `notify_on_output` whose `pattern` matches the line that means "look again". Give it a `reason` that says why you are watching. The watcher wakes you on each match until you stop it.
   - Always arm a one-shot fallback as well, so the loop continues if no event comes. Use `tmux_run` with `command: "sleep <seconds>"` and `wake: "<what to do next>"`. Pick the delay from the work: seconds for something about to finish, minutes for a build or review, an hour or more for slow-moving state.
3. When woken, run the prompt again, choose the next delay, and arm the next fallback. Keep one fallback armed at a time.
4. Say in one line how the loop paces itself, so the user knows what to expect.
5. When the condition holds or the work is done, stop every loop job with `tmux_jobs` `stop` and tell the user.

## Rules

- Never poll with a long blocking command in your own turn. End the turn and let the wake arrive.
- Never background a command with `&`. Use `tmux_run`.
- Keep each run small, and report only what changed since the last run.
- If a run fails the same way three times, stop the loop and report the failure instead of repeating it.
- Stop every job you armed once the loop ends. Check with `tmux_jobs` `list`.
