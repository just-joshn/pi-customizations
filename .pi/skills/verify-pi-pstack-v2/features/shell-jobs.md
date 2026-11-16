# Shell job lifecycle

Users ask Pi to run work without blocking their session, inspect its output, receive completion reports and stop long-running jobs or heartbeat series.

## Sub-features

- `jobs-run`: sandboxed command writes a result and exits successfully.
- `jobs-inspect`: list, output and wait report the returned job ID and result.
- `jobs-stop`: stopping a running command terminates it.
- `jobs-wake`: a completion notice reaches the parent without an extra user prompt.
- `jobs-repeat`: heartbeat restarts after clean completion and stops as a series.

## How to get to it (user POV)

- Ask Pi in the TUI to use tmux_run and tmux_jobs.
- Ask through native `pi -p` using the same isolated profile/resources; print mode settles pending wake jobs before returning.

## Driving it with the PTY helper

Preconditions:

- Unsandboxed live launcher, genuine model access and healthy doctor.
- Parent tools pi_spawn, tmux_run and tmux_jobs are available; do not use host-session calls as replacement proof.

- **Run and inspect:** send `python3 "$HELPER" send "$EVIDENCE" $'Use tmux_run to start name verify-shell with command printf PSTACK_JOB_OK > job-result.txt and wake PSTACK_WAKE_OK. Record the returned ID. Use tmux_jobs list, then wait on that exact ID with timeout_seconds 30, then output for it. Do not use bash to run the command yourself.'`. Require actual calls, exited 0, output/list state for that ID and scratch work/job-result.txt containing PSTACK_JOB_OK. Read the file independently.
- **Wake:** in a fresh request ask `Use tmux_run with name verify-wake, command sleep 2; printf PSTACK_WAKE_BODY, and wake PSTACK_WAKE_NOTICE. End your turn without wait. When the notice arrives report it; do not start another job.` Submit through send with Enter. Require the actual pstack-job notice and output without an additional user message. Wait in the observer, not by sending a new prompt.
- **Stop:** ask `Use tmux_run name verify-stop with command sleep 300 and no wake. Use tmux_jobs list, then stop the exact returned ID, then list again. Do not start other jobs.` Require running before stop and non-running afterwards; preserve returned ID, stop result and exit marker.
- **Heartbeat:** ask `Use tmux_run name verify-tick with command sleep 2; printf PSTACK_TICK, wake PSTACK_TICK_NOTICE, repeat true. After one notice stop that series with tmux_jobs stop and list jobs. Do not start another series.` Require multiple same-series runs before stopping, then no new run over two further tick periods. If only one ran, do not claim restart coverage.
- **Print entry:** repeat the run/wake request with native `pi -p`, isolated profile/cwd and the exact resource flags from command.json; capture stdout/stderr/exit. Require the wake report before the process returns.

## Gotchas

- The baseline has no auth; all these journeys fail that precondition until real login.
- tmux_run commands read no stdin. Use the PTY helper for terminal input.
- A wait result is not proof of asynchronous wake delivery; test those separately.
- Print runs can remain alive while a wake job never finishes. Set a bounded external timeout, and stop only owned jobs on failure.
- Interactive Pi exit leaves jobs running. Stop jobs and preserve their logs before scratch cleanup.
