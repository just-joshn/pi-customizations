# @justjoshn/pi-pstack-team-kit

Pi skills package with:

- **pstack** (v0.15.46): operational skills, `principle-*` skills, `poteto-mode` playbooks, `poteto-agent`, `comment-sicko`
- **team kit** (v1.2.0): CI/review/shipping/control/verify skills, `ci-watcher`, `thermo-nuclear-code-quality-review`, and the two always-on engineering rules

The pstack source pin is `d42aff08aa58965d2735c4ead61a9af82b89d0d0`. `skill-map.json` comes from the same pstack and team-kit content, taken from the published map for `pstack 0.15.46 · Team Kit 1.2.0`. The package keeps the upstream workflow instructions where they apply and uses Pi's skill commands, subagent tools, and session paths. Automation creation and webhook wakes require a configured provider. Pi core does not supply the upstream editor or webhook service.

## Layout

- `skills/` — pstack + team-kit skills (including `poteto-mode` playbooks/scripts and `pr-review-canvas` assets)
- `agents/` — `poteto-agent.md`, `comment-sicko.md`, `ci-watcher.md`, `thermo-nuclear-code-quality-review.md`
- `rules/` — `no-inline-imports.md`, `typescript-exhaustive-switch.md` (paste into `AGENTS.md` / `${PI_CODING_AGENT_DIR:-~/.pi/agent}/AGENTS.md`; Pi has no `.mdc` alwaysApply)
- `scripts/verify-skill-map.mjs` — checks the package against `skill-map.json`
- `skill-map.json` — the pstack skill map this package ports
- `TEAM-KIT-LICENSE` — upstream team-kit MIT license text

## The skill map is the contract

`skill-map.json` names 161 nodes: the pstack and team-kit skills, their playbooks, the subagent lanes, the bundled scripts, and the state that only exists at run time. `npm test` reads that file and requires every node to be one of two things:

- shipped as exactly one artifact, whose path and `name` frontmatter the map decides;
- declared out of scope in `scripts/verify-skill-map.mjs` with a reason, such as a Cursor CLI feature Pi has no counterpart for or a board written at run time.

The check also fails on an artifact no node claims, on any shipped markdown that names a Cursor path, tool, or UI, and on `poteto-mode` naming a team-kit skill other than `deslop`, `control-ui`, and `control-cli`. Add or drop a node in the map and the check tells you which artifacts must follow. Everything it asserts is measured from the shipped files, so a rename in prose is a failure, not a silent drift. The map ships with the package, so `npm test` works in an installed copy too.

The map decides inventory and structure, not prose. Each node's `what`, `when`, and `how` compress a longer instruction, so where a shipped file goes further than its node, the file is the fuller statement and both agree. A node that names a Cursor-only mechanism is satisfied by the Pi mechanism that does the same job, or by the README declaring that service unavailable.

## Where Pi loads this after install

Pi does **not** copy skills into `~/.agents/skills`. It loads them from the installed package tree via `package.json` → `pi.skills`.

| Install style | Package root on disk | Skills live at |
| --- | --- | --- |
| Local path | the path you passed to `pi install` | `<root>/skills/...` |
| npm (user) | `${PI_CODING_AGENT_DIR:-~/.pi/agent}/npm/node_modules/@justjoshn/pi-pstack-team-kit` | `<root>/skills/...` |
| npm (project) | `<repo>/.pi/npm/node_modules/@justjoshn/pi-pstack-team-kit` | `<root>/skills/...` |
| git (user) | under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/git/...` | `<root>/skills/...` |
| git (project) | under `<repo>/.pi/git/...` | `<root>/skills/...` |

Playbooks and principles stay inside those skill folders. Agents stay under `agents/`. The companion `@justjoshn/pi-subagents` extension discovers them from the installed package, so keep the package installed and do not copy them.

## Install

This package ships skills, including `/skill:loop`, `/skill:create-skill`, `/skill:automate`, and `/skill:goal`. The workflows call tools from these companion packages:

- `@justjoshn/pi-subagents` provides `task` and `await_subagent`. The delegated workflows use `task`; `swarm` and `loop` also use `await_subagent`.
- `@justjoshn/pi-modes` provides `ask_question` and `switch_mode`. `setup-pstack`, `automate-me`, `automate`, and `create-skill` use `ask_question`; `poteto-help` points at `switch_mode`.

- `@justjoshn/pi-goals` provides `create_goal` and `update_goal` for `/skill:goal`. The loop skill does not use goals.

Install from a checkout. Run `bun install` first, because the companions load their dependencies from the repo's `node_modules`.

```bash
bun install --frozen-lockfile
pi install ./extensions/no-ceilings/pi-subagents
pi install ./extensions/no-ceilings/pi-modes
pi install ./extensions/no-ceilings/pi-goals
pi install ./extensions/no-ceilings/pi-pstack-team-kit
```

A user or project skill copy wins over the package. Archive older copies of these skills:

```bash
node extensions/no-ceilings/pi-pstack-team-kit/scripts/purge-shadowed-skills.mjs
node extensions/no-ceilings/pi-pstack-team-kit/scripts/purge-shadowed-skills.mjs --apply
```

The script moves them to `${PI_CODING_AGENT_DIR:-~/.pi/agent}/backups/pstack-team-kit-shadows-<timestamp>`. It never deletes a skill.

`@justjoshn/pi-subagents` discovers the packaged agents from `agents/` automatically. Older versions that predate package discovery need a manual copy into `${PI_CODING_AGENT_DIR:-~/.pi/agent}/agents` or `.pi/agents`. A copied agent finds its sibling skills through the `packages` list in Pi's `settings.json` for local-path installs, and by searching `${PI_CODING_AGENT_DIR:-~/.pi/agent}` and the project's `.pi` directory for npm and git installs. Keep the package installed.

`/skill:automate` requires a configured editor that can open an unsaved draft. `/skill:make-bot-ui` also requires an authenticated webhook provider that can wake a Pi run. Neither skill creates or enables an automation without the editor handoff.

`node_modules` under skill scripts is omitted; restore with `bun install` in `skills/poteto-mode/scripts` when needed.
