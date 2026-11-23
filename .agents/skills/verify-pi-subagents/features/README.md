# Feature map: `pi-subagents`

The map lists the user-facing surfaces of the extension and the real harness that exercises each one. Start with the feature that changed. Every drive creates a fresh temp workspace and prints its evidence root.

| Feature | User-facing result | Primary harness |
| --- | --- | --- |
| [Delegation](delegation.md) | A parent asks for work and receives a child result from `task` | `scripts/run-scenario.sh delegation` |
| [Custom agents](custom-agents.md) | A `.pi/agents` Markdown file becomes a selectable subagent | `scripts/run-scenario.sh custom` |
| [Background and worktrees](background-worktree.md) | A task runs in the background, can be awaited, and can use an isolated branch | `scripts/run-scenario.sh background` |
| [Read-only isolation](isolation-readonly.md) | A child cannot write or start repository helper programs | `scripts/run-scenario.sh security` |
| [Observability](observability-tasks.md) | Transcripts, checkpoints, persisted state, and the `/tasks` pager reveal what ran | `scripts/run-scenario.sh delegation` and `growth` |

The deterministic scenarios need no model credentials. The `custom` and `background` scenarios use the real model and exit `77` when credentials are absent. Treat `77` as a skip, not a product failure.

Repo root paths in these files are relative to `extensions/no-ceilings/pi-subagents` unless stated otherwise. Evidence always goes under `/tmp/pi-subagents-verify-evidence/<UTC timestamp>/`, never inside the temp rig.
