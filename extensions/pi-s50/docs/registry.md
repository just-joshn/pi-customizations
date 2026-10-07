# About the S50 skill registry

S50 may depend on an external agent skill only when that skill is inside the skills.sh all-time top 50 at the moment a registry snapshot is taken. The rule covers external skills only. Filesystem, shell, Git, worktrees, test runners, HTTP clients, browser drivers, and generic agents are host capabilities, not skills.

## Commands

| Command | Effect |
| --- | --- |
| `s50 registry refresh` | Confirm the ranking basis, fetch the leaderboard, resolve every S50 skill upstream, and write `.s50/registry.lock.json`. |
| `s50 registry refresh --from <leaderboard.json>` | Build the lock from a captured leaderboard and pinned sources. No network. |
| `s50 registry refresh --sources <file>` | Use a different skill-source file. The default is the package's `registry/skill-sources.json`. |
| `s50 registry show` | Print the snapshot time and source, then each locked skill with rank, source, invocation policy, and commit. |
| `s50 registry verify` | Check every locked skill ranks 50 or better and matches its leaderboard entry. |

A live refresh does four things in order:

1. It reads `https://skills.sh/docs/faq` and fails unless the page still says the leaderboard comes from anonymous telemetry of installation counts.
2. It parses the all-time leaderboard embedded in `https://skills.sh/`.
3. For each skill, it reads the repository's current `HEAD` with `git ls-remote`, fetches `SKILL.md` at that commit, checks that its `name` matches, takes the invocation policy from `disable-model-invocation` read as a YAML boolean (`true`, `True`, or `TRUE`, with spacing and a trailing comment allowed), and records the sha256 of the file.
4. It writes the lock with the timestamp, the source URL, and the top 50 entries with rank and install count.

## Required and optional skills

S50 requires the 13 skills it routes to or gates on: `grilling`, `domain-modeling`, `codebase-design`, `prototype`, `tdd`, `diagnosing-bugs`, `frontend-design`, `vercel-react-best-practices`, `web-design-guidelines`, `agent-browser`, `triage`, `improve-codebase-architecture`, and `setup-matt-pocock-skills`. It also locks 5 optional skills it knows about but never routes to: `find-skills`, `grill-me`, `grill-with-docs`, `handoff`, and `teach`.

A refresh fails closed. When a required skill has no top-50 entry from its pinned repository (a same-named skill from another source does not count), or has no pinned source, or when the leaderboard has fewer than 50 entries, it writes a rejected lock, exits 2, and no new run starts until a refresh succeeds. An optional skill outside the top 50, or one whose `SKILL.md` fails to resolve, is left out of the new lock. A network or parse failure on the leaderboard or a required skill writes nothing and exits 1. The leaderboard source is redacted before it is stored.

## Snapshots and runs

A new run copies the approved lock into `run.skillRegistry`. No command changes that copy, so a refresh during an active run cannot change which skills the run may call. A skill that leaves the top 50 stays usable by the run that locked it.

## Locking sources

S50 does not copy third-party SKILL.md bodies. It records the repository, the commit, the path, and the sha256 of the SKILL.md at that commit. The installed skill package is what runs. Preflight hashes the installed SKILL.md files that Pi reports and records a risk when one differs from the lock.

## Why install count is not a quality score

skills.sh ranks by installation telemetry. Its FAQ says the leaderboard "is powered by anonymous telemetry data from the skills CLI" and "only tracks aggregate skill installation counts". An install says someone ran `npx skills add`. It says nothing about whether the skill worked. S50 uses rank only as an eligibility cut-off and never orders, weights, or prefers skills by rank or installs.

## Why strict mode excludes useful skills

`code-review` (rank 55), `ask-matt` (56), and `implement` (57) were outside the top 50 on 2026-10-07, and `implement-spec` and `wayfinder` were not in the captured top 60. Several would help. Strict mode excludes them because the point of the constraint is a dependency set anyone can reproduce from one public, dated snapshot. Allowing useful exceptions turns the rule into a judgment call per run. S50 implements its own review phase instead of calling `code-review`.

## Live registry facts on 2026-10-07

Captured at 2026-10-07T09:14:55Z from `https://skills.sh/`, page sha256 `246e0d3d…d9`. Fixture: `test/fixtures/leaderboard.2026-10-07.json`, with the raw page chunk in `test/fixtures/skills-sh.2026-10-07.excerpt.html`. The commits are the ones pinned in `registry/skill-sources.json`.

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

`teach` is user-only at this revision (`disable-model-invocation: true`).

A live refresh at 2026-10-07T15:27Z found the same ranks for all 18 skills. By then `mattpocock/skills` had moved from `dd400c3` to `f3fc563`, and five of the locked SKILL.md files there had changed, so a live refresh locks the newer commit and hashes.

Each locked skill carries its runtime prerequisites. `agent-browser` needs the `agent-browser` CLI on `PATH`. `web-design-guidelines` fetches its rules from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` on every run. `triage` needs the `docs/agents/issue-tracker.md` that `setup-matt-pocock-skills` writes. `find-skills` uses the `skills` CLI.
