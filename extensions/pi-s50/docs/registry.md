# About the S50 skill registry

S50 may depend on an external agent skill only when that skill is inside the skills.sh all-time top 50 at the moment a registry snapshot is taken. The rule covers external skills only. Filesystem, shell, Git, worktrees, test runners, HTTP clients, browser drivers, and generic agents are host capabilities, not skills.

## Commands

| Command | Effect |
| --- | --- |
| `s50 registry refresh` | Fetch `https://skills.sh/` (all-time view), parse the leaderboard, and write `.s50/registry.lock.json`. |
| `s50 registry refresh --from <leaderboard.json>` | Build the lock from a captured leaderboard file. No network. |
| `s50 registry refresh --sources <file>` | Use a different skill-source file. The default is the package's `registry/skill-sources.json`. |
| `s50 registry show` | Print each locked skill with rank, source, and invocation policy. |
| `s50 registry verify` | Check every locked skill is ranked 50 or better and matches its leaderboard entry. |

A refresh stores the top 50 entries with rank and install count, the timestamp, and the source URL. It locks each of the 18 S50 dependencies with repository, commit, path, SKILL.md sha256, invocation policy, and runtime prerequisites. It fails closed: if any required dependency ranks below 50 or is missing, it writes nothing and exits 2 with the names.

## Snapshots and runs

A new run copies the current lock into `run.skillRegistry`. No command changes that copy, so a refresh during an active run cannot change which skills the run may call. A skill that leaves the top 50 stays usable by the run that locked it and is refused for every new run.

## Locking sources

S50 does not copy third-party SKILL.md bodies. It records the strongest identifier available: the Git commit of the source repository, the path, and the sha256 of the SKILL.md content. The installed skill package is what runs.

## Why install count is not a quality score

skills.sh ranks by installation telemetry. Its FAQ, read on 2026-10-07, says the leaderboard "is powered by anonymous telemetry data from the skills CLI" and "only tracks aggregate skill installation counts". An install says someone ran `npx skills add`. It says nothing about whether the skill worked. S50 uses rank only as an eligibility cut-off and never orders, weights, or prefers skills by rank or installs.

## Why strict mode excludes useful skills

`code-review` (rank 55 on 2026-10-07), `ask-matt`, `implement`, `implement-spec`, and `wayfinder` are outside the top 50. Several would help. Strict mode excludes them because the point of the constraint is a dependency set anyone can reproduce from one public, dated snapshot. Allowing "useful" exceptions turns the rule into a judgment call per run. S50 implements its own review phase instead of calling `code-review`.

## Live registry facts on 2026-10-07

Captured at 2026-10-07T09:14:55Z from `https://skills.sh/` (page sha256 `246e0d3d…d9`). Fixture: `test/fixtures/leaderboard.2026-10-07.json`, with the raw page chunk in `test/fixtures/skills-sh.2026-10-07.excerpt.html`.

| Rank | Skill | Source | Installs | Policy | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | find-skills | vercel-labs/skills | 3,727,722 | model | `48dc9e8` |
| 2 | grill-me | mattpocock/skills | 1,298,039 | user | `dd400c3` |
| 3 | grill-with-docs | mattpocock/skills | 1,111,185 | user | `dd400c3` |
| 4 | improve-codebase-architecture | mattpocock/skills | 1,059,496 | user | `dd400c3` |
| 5 | agent-browser | vercel-labs/agent-browser | 1,048,474 | model | `f7c8b07` |
| 6 | tdd | mattpocock/skills | 1,030,912 | model | `dd400c3` |
| 7 | frontend-design | anthropics/skills | 958,540 | model | `683bc88` |
| 8 | setup-matt-pocock-skills | mattpocock/skills | 952,086 | user | `dd400c3` |
| 9 | handoff | mattpocock/skills | 930,879 | user | `dd400c3` |
| 10 | triage | mattpocock/skills | 898,670 | user | `dd400c3` |
| 11 | prototype | mattpocock/skills | 894,819 | model | `dd400c3` |
| 12 | grilling | mattpocock/skills | 850,171 | model | `dd400c3` |
| 16 | vercel-react-best-practices | vercel-labs/agent-skills | 775,487 | model | `063bee9` |
| 17 | domain-modeling | mattpocock/skills | 769,504 | model | `dd400c3` |
| 18 | teach | mattpocock/skills | 764,505 | user | `dd400c3` |
| 19 | codebase-design | mattpocock/skills | 746,467 | model | `dd400c3` |
| 42 | diagnosing-bugs | mattpocock/skills | 730,107 | model | `dd400c3` |
| 47 | web-design-guidelines | vercel-labs/agent-skills | 706,188 | model | `063bee9` |

`teach` is user-only at this revision (`disable-model-invocation: true`), unlike the prompt's original model-invocable list.

Each locked skill carries its runtime prerequisites. `agent-browser` needs the `agent-browser` CLI on `PATH`. `web-design-guidelines` fetches its rules from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` on every run. `triage` needs the `docs/agents/issue-tracker.md` that `setup-matt-pocock-skills` writes.
