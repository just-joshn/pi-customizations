### Autonomous run

**You own the exit condition. Define done, then drive to it without stopping.**

1. State the exit condition as a checkable predicate before the first iteration (tests green, repro fixed, all N PRs merged, pixel-diff zero). Write down with it the permissions you hold, the workspace (worktree and base), and where the decision trail lives.
2. Pick the wake mechanism with `/loop` or `tmux_run` (`notify_on_output` / `wake`). An event to watch (CI, a merge, a ref advancing) gets a watcher job (`tmux_run` with `notify_on_output` or `wake` set to what to do next), with a long `/loop` heartbeat as fallback. No event gets a fixed-interval `/loop <interval> <prompt>` heartbeat (or `tmux_run` with `repeat: true`) sized to when the result is worth re-checking. Stop a loop with `/loop stop` (or `tmux_jobs` `stop`). Pick each worker's thinking level for the job, per the Spawned Pi workers section.
3. Each iteration makes the smallest change the evidence justifies, verifies it against the predicate, commits if it advanced, discards changes that didn't help. Belt-and-suspenders that "might help" gets reverted, not left to ride.
   Sequence the work via the **sequence-verifiable-units** principle skill, verifying each unit before the next instead of batching checks at the end.
4. Mid-run discoveries that support the goal are yours. Address broken skills, related bugs, flaky verifiers, review noise, tooling failures, orphaned follow-ups, and fixable drift yourself via poteto-mode. Put out-of-band fixes in their own PR. Do not park reversible work for the human or ask them in plain text. Surface only irreversible actions, genuine product or preference calls no experiment can settle, or a real dead end. Keep the predicate as the main drive, and return to it after each side fix.
5. Checkpoint every iteration via the **show-me-your-work** skill, a row for what changed and whether the predicate moved.
6. Stop when the predicate is met. A plateau is not a stop, so keep going and pivot your approach to push past it. Surface a genuine dead end rather than spinning, and never relax the predicate to declare victory.

**Reply:** the exit condition, iterations run, what landed, what was discarded, final predicate state.
