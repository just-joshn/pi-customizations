---
name: loop
description: Run a prompt on a fixed or dynamically selected interval using native monitored background shells for this Pi session or durable subscriptions for unattended work. Use for /loop and program audit ticks.
disable-model-invocation: true
---

# Loop

## Mechanism selection

For session-attached local work, use `BackgroundShell` with monitored sentinel output and follow the local sections below. For durable, cron, or unattended work that must survive the initiating UI closing, use native `SubscribeTimer`, `ListSubscriptions`, and `Unsubscribe`. A timer owns a dedicated persistent Pi root, seeded with the initiating conversation as historical context. It does not write to the initiating interactive transcript. Report the returned run ID, session file, subscription ID, and this ownership boundary.

## Parse

Accept `/loop [interval] <prompt>`. Leading `5m check status`, trailing `check status every 5m`, and units seconds, minutes, hours, or days mean a fixed schedule. Convert to positive seconds. With no interval, choose the next useful delay dynamically. Empty prompts print `Usage: /loop [interval] <prompt>` and stop.

If the prompt names an exit predicate such as `until done` or `until CI is green`, evaluate it at the start of every tick and stop the loop when it passes instead of running the prompt again. For pursuit that must run to completion, use `/goal` (`CreateGoal`) and let `/loop` supply only the wake.

`SubscribeTimer` accepts exactly one of `delaySeconds` or a five-field numeric `cron` expression (minute hour day month weekday). Cron supports lists, ranges, and steps. Set `timezone` explicitly for cron; the default is UTC. Sunday is 0 or 7. When both day-of-month and weekday are restricted, either may match. Spring-forward nonexistent times are skipped; repeated fall-back wall times can fire twice.

## Durable fixed schedule

1. Choose a purpose name, such as `loop-program-audit`.
2. Call `SubscribeTimer` with name, prompt, and delaySeconds or cron. The dedicated Pi root runs the prompt immediately, then repeats; do not also run it in the initiating session. `runImmediately: false` defers the first run.
3. A duplicate active name returns the existing settings unchanged. To change prompt or schedule, unsubscribe first, then subscribe again.
4. Confirm the actual returned settings and persistent session identity. Ticks are serialized in that root. Overlapping or missed intervals coalesce instead of producing an unbounded backlog.

## Durable dynamic schedule

Subscribe with an initial delay and a prompt that carries these instructions: perform the work, choose the next useful delay, unsubscribe the current subscription, then rearm with the same name and `runImmediately: false`. The timer root's tools manage its owning subscriptions. Self-cancellation persists immediately and lets the current turn finish; it never starts another wake from that subscription.

A real event watcher can remain the primary signal. Use the durable timer as a fallback heartbeat only when needed; do not add a second polling loop over a watcher that already polls. An external event integration must deliver a real Pi turn; plain stdout alone is not a wake.

## Durable stop

Call `ListSubscriptions`, identify the subscription by name or ID, then `Unsubscribe`. External cancellation persists before acknowledgment and aborts and drains that subscription's active turn. Repeat cancellation is safe. Do not rearm. If several subscriptions could match the requested stop, report their names and ask which one.

## Durable lifetime and limits

Subscriptions survive closing, switching, or reloading the initiating Pi UI. No timer process starts merely because this package is installed. After a supervisor crash, call `RestartSubscriptions` from the initiating session. It restores subscriptions and their IDs, reattaches a living Pi root, or resumes the saved transcript only after excluding the prior writer. Cancellation remains persisted. No OS login service is installed; recovery after a machine reboot has not been verified and is not automatic.

Every occurrence has a durable invocation ID. Recovery delivers occurrences that had not been attempted, follows an already accepted occurrence, and coalesces overdue ticks. An attempted occurrence with uncertain completion is disabled and listed as `needs_reconciliation`; inspect its transcript and external effects before explicitly subscribing again. Never claim exactly-once external side effects. Service failures are reported explicitly. API credentials and executable resources must remain available to the dedicated Pi process.

List and stop from the original initiating session or its timer root. The returned transcript is the source of execution evidence; receipt of subscription creation alone does not prove a completed tick.

## Local fixed schedule

1. Call `BackgroundShellList`. If a running shell already prints this loop's sentinel, do not start another.
2. Call `BackgroundShell` with title `Loop every <interval>: <prompt>`, `notify_on_output: "^AGENT_LOOP_TICK_<purpose>"`, and this command:

   ```bash
   while true; do
     sleep <seconds>
     echo 'AGENT_LOOP_TICK_<purpose> {"prompt":"<prompt>"}'
   done
   ```

3. Smoke-check the shell startup and monitored-output pattern before calling it armed. Run the prompt once now. The first tick arrives only after the first sleep, so startup never runs it twice.
4. Confirm the interval, that the prompt already ran, when the first tick lands, and that it repeats until stopped. Record the shell id. On later ticks, give a short update of what changed.

## Local dynamic schedule

1. Run the prompt now.
2. If the next run waits on an event (a ref advancing, a log line, a file change, a CI check), start one watcher with `BackgroundShell`, titled `Loop dynamic: <prompt>`, that prints `AGENT_LOOP_WAKE_<purpose> {"prompt":"<prompt>"}` only when the event fires, with `notify_on_output: "^AGENT_LOOP_WAKE_<purpose>"`. Skip this on later ticks while the watcher still runs. A watcher subagent through `Task` in the background also wakes you on completion.
3. At the end of each turn, start a one-shot heartbeat with the same pattern and the same title:

   ```bash
   sleep <seconds>
   echo 'AGENT_LOOP_WAKE_<purpose> {"prompt":"<prompt>"}'
   ```

   With a watcher, this is the fallback, so lean long. Without one, it is the cadence. Size it to when the result is worth checking again.
4. On wake, act on the prompt in the latest matching line, then start the next heartbeat. Restart the watcher only if it exited. If a watcher wake and a heartbeat wake both arrive, act once. If both an output wake and a shell completion notification arrive, act on the output and ignore the completion.
5. Confirm that you self-pace, whether a watcher is the primary signal, and the fallback delay.

## Local payload

A wake message names the output file and the matching line. Put the prompt beside the sentinel as JSON so it can change from tick to tick. While one wake waits in the queue, later matches from the same shell are counted but not sent, so a slow turn never builds a backlog. When the line is cut short or the prompt varies, act on the last matching line in the output file.

## Local stop

Call `BackgroundShellStop` for the loop's shell and for any watcher. Do not start another heartbeat. A match that arrived during that turn is dropped, so do not wait for it. Say the loop stopped and why. If several shells match the purpose and you cannot tell which one the user means, list them and ask.

## Local limits

- Shells live only as long as this Pi session. Quitting, `/reload`, or switching sessions stops every loop. Re-arm after a restart.
- Title every loop shell, watcher, and heartbeat `Loop <schedule>: <prompt>` (for example `Loop every 5m: check deploy status`).
- Adapt loop syntax to the user's shell (for example PowerShell `while ($true) { ... Start-Sleep }` on Windows). The examples here use bash.
- Prefer monitored shell output over OS cron when the agent needs wake notifications; stdout stays attached to the monitored task.
- Use a unique sentinel per loop. Keep the loop quiet apart from the sentinel.
- Do not create duplicate fixed loops or dynamic sleepers.
- A nonzero exit from a shell also wakes you. Treat it as a failed watcher and re-arm or report it.
