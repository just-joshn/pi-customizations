# Native-gap gate: `environment: "cloud"` as a git worktree

This note answers the eight questions in `extensions/AGENTS.md` (Native-gap gate) for `src/task/worktree.ts`.

1. **Required behavior.** A `Task` call with `environment: "cloud"` runs the subagent in its own copy of the repository, on its own branch, from `cloud_base_branch` or the current commit. The parent merges that branch afterward. Sources: Cursor's subagents docs ("Isolated project copies"), and upstream pstack's Claude Code adapter, which maps `environment: "cloud"` to `isolation: "worktree"`.
2. **Pi mechanism evaluated.** Pi 1.3.0 has no subagent API. pi-pstack's `Task` tool is already the adapter that starts each subagent as a `pi --mode json` child process. The installed `ExtensionAPI` types have no isolation, sandbox-filesystem, or working-copy primitive.
3. **Why the public API cannot express it.** The only place a child's filesystem is chosen is the `cwd` that `Task` passes to the child process. Pi has no API to give a child process a separate copy of the repository.
4. **Why omitting it is unacceptable.** pstack's `swarm` skill and `orchestrate` playbook spawn every worker with `environment: "cloud"`. Before this change, every such spawn failed once, and parallel writers shared one checkout unless each brief remembered to create a worktree.
5. **Smallest adapter.** `planWorktree` resolves the base by reading git. `addWorktree` runs one `git worktree add -b`. Both live in `worktree.ts`. `Task` passes the worktree as the child's `cwd`, and the subagent record stores it so `resume` can use it again.
6. **Pi-owned state that stays authoritative.** The child is an ordinary Pi session. Its transcript, session ID, compaction, tools, model, and permissions are Pi's. The agent record and the session directory stay keyed on the parent workspace, as for local agents.
7. **Verification.**
   - **Lifecycle and branching.** Six end-to-end cloud tests in `test/e2e/task.e2e.test.ts` run real git, covering the child's working directory, the base commit, `cloud_base_branch`, a directory outside git, resume, and a missing worktree. A live run on `deepseek/deepseek-flash` is in `evidence/live-cloud.txt`.
   - **Cancellation.** `test/task-worktree.test.ts` aborts a checkout whose `post-checkout` hook sleeps 30 seconds, and it stops in under 5 seconds.
   - **Permissions.** The readonly floor and the depth cap use the same paths as local agents.
   - **Accounting.** Usage flows through the child as for local agents.
8. **Deletion condition.** Delete the adapter when Pi offers a subagent isolation or working-copy API, or when `Task` itself moves into Pi.
