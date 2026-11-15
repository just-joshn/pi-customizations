### Orchestrate

**You run the program, never the code. Decide which worker does each piece of work, then check what each one produces.** For a standing project handed to one coordinator session: multi-day, many stacked PRs, dozens to hundreds of workers, few human turns. One task driven to a predicate is Autonomous run. One ambitious run that needs a bespoke workflow is figure-it-out. Work that one agent could finish inside the session's budget is not a program.

Run it with your own tools. Spawn workers with `pi_spawn`. Keep the program's state in `notes.md` at the root of your checkout, never staged, like `TODO.md`. Each worker's report and session stay in its job directory under `~/.pi/agent/pstack-v2/jobs/<id>/`. Watch each PR with a `tmux_run` watcher on `gh pr checks <pr> --watch` whose `wake` names the next step. Call no scripts, run no polling loops of your own, and never relay messages or status between agents.

#### Topology

- **One owner per PR.** The owner is the only writer of its branch and carries the PR from build to merge. Only the owner pushes, rebases, or retargets it. Closing or retargeting a base PR orphans every PR above it, so the owner does that only on your call. You never author or edit code. Conflicted merges, chain rebases, and fixes go to owners.
- **A fresh worker for each independent task.** Its kickoff carries everything it needs, including each upstream report it depends on, pasted in full. Workers can't see their siblings. Run each worker in its own git worktree (`pi_spawn` with `worktree` and `base`) unless the work needs this checkout's own state, such as uncommitted changes or a process already running here. Pick each worker's thinking level for the job, per the Spawned Pi workers section.
- **A sub-coordinator only when one area has many parallel workers.** It owns that area's workers and kickoffs and sends you one rollup, never raw worker reports. Stop at three levels: you, sub-coordinators, and workers. Keep about ten workers in flight per coordinator, and start the next one as each finishes instead of waiting on a whole batch.
- **Resume a worker when new work needs its built state,** such as its worktree, uncommitted changes, or a running process (`pi_spawn` with `resume`). Resume a worker only for a follow-up on the same work. Never resume one to check on it, because a resume starts a new run in its session. Read its output with `tmux_jobs` `output` instead.
- **Each PR gets a verifier that isn't its author,** on a different model family. The owner merges only on that verifier's pass at the current head.
- **Start with one unit.** Take it through kickoff, owner, verifier, and merge before you fan out, so a flaw in the kickoff costs one agent instead of fifty. On near-identical cheap units, the first unit is that test.

#### Supervision

- **Each kickoff names the evidence that proves the work is done,** such as a command and its expected output, a control-skill check, or an artifact. It also names the goal, the paths the worker may and may not write, and the actions it must not take. If you can't name the evidence, the unit isn't scoped yet.
- **Read the diff or the artifact, not only the worker's summary.** Green CI is an input to a verdict, not a verdict. Behavioral work needs more than a type check. A verdict covers one head SHA, so a new push needs a new verdict. Read a sample of each sub-coordinator's kickoffs while its workers run, and fix its instructions when one fails.
- **Send back work that drifts from scope or grows past what was asked.** Keep only the fixes that block the program, and park the rest as follow-ups.
- **Check a PR's live state before you report on it,** with `gh pr view` and `gh pr checks` or your forge's equivalents, not the worker's last report. Account for every worker you spawned as done, replaced, or absorbed into another worker's scope.
- **Stop or replace a worker that stalls or loops.** Stop it with `tmux_jobs` `stop`. Judge it by its pushes and PR activity, not its status text. Retry by cause: a smaller scope after a context or memory limit, the same kickoff after a dropped connection, and a different model after a tool error. After two retries, drop the unit and replan around it. When a stopped worker returns late, check its result against the PR's current state, and hand any unique findings to a fresh worker.
- **Ask the user only for a real decision or a blocker,** such as an irreversible action, a product or preference call that no experiment settles, or a dead end that survived a replan. Rebase mechanics, retries, CI flakes, review triage, and "should I keep going" never reach the user.

**Reply:** what landed against the goal, each PR's live state and verdict with its link, what was dropped and why, and the decisions waiting on the user.
