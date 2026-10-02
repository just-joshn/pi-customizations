# Changelog

Revisions follow the pinned upstream pstack version, then `-pi.N` for this package's own releases.

## 0.15.5-pi.2

- Integrates the team-kit 1.2.0 workflows, including the CI and PR skills, `/pr-review-canvas`, and the strict code-review rubric.
- Adds the local `/loop` skill and template on native `BackgroundShell` wakes, and the `/goal` command with `CreateGoal`, `GetGoal`, and `UpdateGoal`.
- Adds native `Task` workers with the `generalPurpose`, `poteto-agent`, `comment-sicko`, `ci-watcher`, and thermo review personas, plus `environment: "cloud"` detached worktrees.
- Adds durable timers, routines, and the dormant Benny pack with its Pi setup adapter.
- Hardens TodoWrite, AskQuestion, setup dialogs, history scoping, and shell wake delivery against the failures found by driving the real CLI.
- Moves the test suite to Vitest 5 with V8 coverage and adds the real-CLI journey checks.
- Declares the repository and homepage, a gallery image, a minimum Pi version for the host peers, and a pull request workflow.
- Ships a Pi adaptation of the ten-chapter guide under `docs/guide/` and a playbook and skill reference in the README.
- Makes poteto mode trigger on Anthropic models at any effort. Below `high`, those models skipped the playbook read and the todolist. In poteto mode, each prompt to an `anthropic-messages` model now carries a hidden first-action rule, sent from `before_agent_start`. Other model families are unchanged.

## 0.15.5-pi.1

- First Pi port of pstack 0.15.5: the preserved upstream snapshot, generated skills and prompt templates, the `pstack_mode` tool, `/poteto-mode`, `/setup-pstack`, and `/pstack`.
