# @justjoshn/pi-pstack-team-kit

Pi skills package with:

- **pstack** (v0.15.46): operational skills, `principle-*` skills, `poteto-mode` playbooks, `poteto-agent`, `comment-sicko`
- **cursor-team-kit** (v1.2.0): CI/review/shipping/control/verify skills, `ci-watcher`, `thermo-nuclear-code-quality-review`, and the two always-on engineering rules

Content is Pi-native (Agent Skills frontmatter, `/skill:<name>`, `task` subagents, Pi session paths). Workflow behavior matches upstream; only Cursor runtime hooks were remapped.

## Layout

- `skills/` — pstack + team-kit skills (including `poteto-mode` playbooks/scripts and `pr-review-canvas` assets)
- `agents/` — `poteto-agent.md`, `comment-sicko.md`, `ci-watcher.md`, `thermo-nuclear-code-quality-review.md`
- `rules/` — `no-inline-imports.md`, `typescript-exhaustive-switch.md` (paste into `AGENTS.md` / `~/.pi/agent/AGENTS.md`; Pi has no `.mdc` alwaysApply)
- `scripts/verify-inventory.mjs` — presence check for the combined inventory
- `TEAM-KIT-LICENSE` — upstream team-kit MIT license text

## Where Pi loads this after install

Pi does **not** copy skills into `~/.agents/skills`. It loads them from the installed package tree via `package.json` → `pi.skills`.

| Install style | Package root on disk | Skills live at |
| --- | --- | --- |
| Local path | the path you passed to `pi install` | `<root>/skills/...` |
| npm (user) | `~/.pi/agent/npm/node_modules/@justjoshn/pi-pstack-team-kit` | `<root>/skills/...` |
| npm (project) | `<repo>/.pi/npm/node_modules/@justjoshn/pi-pstack-team-kit` | `<root>/skills/...` |
| git (user) | under `~/.pi/agent/git/...` | `<root>/skills/...` |
| git (project) | under `<repo>/.pi/git/...` | `<root>/skills/...` |

Playbooks and principles stay inside those skill folders. Agents stay under `agents/` but are **not** auto-registered by Pi packages (no agents resource type). See [Install](#install) to register them.

## Install

This package ships skills only. The workflows call tools from two companion packages:

- `@justjoshn/pi-subagents` provides `task` and `await_subagent`, used by `swarm`, `arena`, `interrogate`, `poteto-mode`, `loop-on-ci`, and `review-and-ship`.
- `@justjoshn/pi-modes` provides `ask_question` and `switch_mode`, used by `setup-pstack`, `automate-me`, and `poteto-help`.

Neither companion is on npm yet, so install all three from a checkout. Run `bun install` first, because the companions load their dependencies from the repo's `node_modules`.

```bash
bun install --frozen-lockfile
pi install ./extensions/no-ceilings/pi-subagents
pi install ./extensions/no-ceilings/pi-modes
pi install ./extensions/no-ceilings/pi-pstack-team-kit
```

To register the agents, copy `agents/*.md` into `~/.pi/agent/agents` or `.pi/agents`. A copied agent finds its sibling skills through the `packages` list in Pi's `settings.json` for local-path installs, and by searching `~/.pi/agent` and the project's `.pi` directory for npm and git installs. Keep the package installed.

`node_modules` under skill scripts is omitted; restore with `bun install` in `skills/poteto-mode/scripts` when needed.
