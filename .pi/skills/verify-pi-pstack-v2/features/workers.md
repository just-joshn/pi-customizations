# Pi worker delegation

Users delegate standalone tasks to separate sandboxed Pi processes and receive their completed reports, with optional role, readonly mode, branch worktree or continuation.

## Sub-features

- `worker-report`: a real worker reads a task fixture and returns a completed answer to its parent.
- `worker-role`: a named bundled role is supplied.
- `worker-readonly`: reads succeed and attempted project writes fail.
- `worker-worktree`: changes stay on a disposable branch/worktree.
- `worker-resume`: a finished worker continues the same stored session.
- `worker-nesting`: first-level worker can delegate, next-level worker cannot.

## How to get to it (user POV)

- Ask Pi to call pi_spawn with a standalone brief.
- Use a workflow such as poteto-mode, swarm, arena or a reviewer skill that delegates work.
- Ask to continue a completed worker by its returned job ID.

## Driving it with the PTY helper

Preconditions:

- Unsandboxed live launcher, genuine model login usable by parent and worker.
- In scratch work create fixture.txt with the text PSTACK_FIXTURE_42. This is verification input, not an injected result.
- Worktree journey additionally requires an initial commit in the disposable Git repo. Seed it with `git -C "$WORK" add fixture.txt && git -C "$WORK" -c user.name=Verify -c user.email=verify@example.invalid commit -m fixture`, where WORK is the exact manifest scratch/work path.

- **Delegate:** send `python3 "$HELPER" send "$EVIDENCE" $'Use pi_spawn name verify-reader, readonly true, wake true. Brief: Read fixture.txt in your working directory using a real tool. Reply with the file contents and your working directory. Do not edit files or start jobs. Use tmux_jobs wait with the returned ID and timeout_seconds 120, then output for it.'`. Require a real separate worker session, fixture tool read, completed PSTACK_FIXTURE_42 answer and matching parent report.
- **Role entry:** ask for a readonly worker with `agent: comment-sicko` to review fixture.txt without edits. Preserve the role-bearing job arguments and completed report; do not equate an ordinary worker with role coverage.
- **Readonly:** ask a new readonly worker to attempt `printf SHOULD_NOT_EXIST > readonly-denied.txt` via bash, report failure, then read fixture.txt. Independently confirm readonly-denied.txt is absent and fixture unchanged. Absence alone without the attempted write is insufficient.
- **Worktree:** after the seed commit ask a worker with `worktree: verify-worker-branch` and `base: HEAD` to write branch-only.txt containing BRANCH_ONLY, without committing. Require the real worktree path and file there, absence in scratch work, and `git -C "$WORK" worktree list --porcelain` showing the branch.
- **Resume:** ask pi_spawn to resume the completed verify-reader ID with brief `Repeat the fixture content you read earlier and name the earlier task; do not reread files.` Require continued session history and a new completed report. A new worker with the old text pasted into its brief is not continuation.
- **Nested delegation:** ask a fresh worker to start one readonly child reader and inspect its report. Require nested job evidence; ask that child to attempt another spawn and record refusal/unavailable tool. Do not replace this with invented reports.
- **Workflow entry:** submit `/skill:poteto-mode Create hello.txt containing HELLO_PSTACK in this disposable repository.`; require its actual pi_spawn calls and reports, persisted plan/checklist files, and independently read hello.txt. Direct pi_spawn coverage does not cover workflow delegation.

## Gotchas

- A standalone brief must name required fixture paths; workers do not inherit parent conversation.
- The initial Git repo has no HEAD: worktree failure before seeding is a real unmet precondition, not a reason to drop base/worktree arguments.
- Model/provider errors, missing credentials or rate limits are failures/blockers, not successful worker reports.
- Native workers can discover user ~/.agents/skills; review their loaded resources and avoid claiming full resource isolation.
- Preserve completed worker session transcripts before cleanup; raw terminal output alone can omit prior completed answers.
