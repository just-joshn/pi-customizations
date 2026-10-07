# Standing orders

Every unit in the user-perspective verification program carries these verbatim.

1. Repo is `/Users/josh-desktop/src/personal/user-perspective-testing-extensions`. Work on the current branch. Never create another branch, never rebase, never force-push, never touch another unit's files.
2. Write only the paths your brief names. Treat everything else as read-only. If you need a change outside your scope, stop and report it instead of making it.
3. Evidence must come from running the real artifact. Never hand-write a receipt, a verdict, or an artifact. If you cannot run it, report `env-limited` with the specific reason.
4. Never weaken a gate, delete an assertion, or widen a tolerance to make something pass. A failing check you cannot fix is a finding, and findings are the point.
5. User-perspective drives run the real `pi` binary that is on `PATH` (currently 1.0.4). Do not substitute a stub for the host. Do not change any package's declared dependency pins unless your brief says to.
6. No network calls to third-party services and no model inference in drives. Use the scripted provider fixtures the repo already has, or add one, so runs are deterministic.
7. Never run `pkill`, `killall`, or any blanket process kill. Kill only processes you started, by pid, and always reap them.
8. Cleanup is scoped: remove your own scratch directories and your own child processes. Never delete `artifacts/`, receipts, or another unit's output.
9. Run the narrowest check that proves your unit before reporting. For a code change, that is the affected package's typecheck plus its test suite.
10. Keep files under 800 lines and functions under 50 lines. Match the surrounding style. Biome is the formatter and linter; `bun run ci` must stay clean.
11. Do not add narrating comments. A comment earns its place only for a non-obvious why the code cannot show.
12. Report shape: status, files changed with `file:line` for the important ones, the exact commands you ran, their observed results, anything you could not verify, and any finding you surfaced outside your scope. Do not paste large logs; point at paths.
