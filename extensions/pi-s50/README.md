# pi-s50

S50 takes a feature, bug, frontend change, external issue, or architecture survey to `PR_READY` in Pi. It refuses to report `PR_READY` while any required evidence is missing, stale, failed, or inconclusive. A deterministic coordinator owns every rule, and the agent only routes. External skills are limited to the skills.sh all-time top 50 at the moment the registry is locked.

## Install

```bash
pi install ./extensions/pi-s50
```

The package ships one extension (`src/index.ts`), one skill (`skills/s50`), and the inspected skill sources (`registry/skill-sources.json`). The external skills that S50 calls are installed separately. When a run needs one that Pi cannot find, the run stops with a `missing_skill` gate that names the install command, for example `npx skills add mattpocock/skills --skill grilling`.

## Use

The same argv works on three surfaces: the model's `s50` tool, the `/s50` command in Pi, and the shell. In a shell, run the CLI from this checkout:

```bash
node extensions/pi-s50/src/cli/main.ts status
```

The `s50` bin in `package.json` runs when it is reached through a symlink into this checkout. Node does not strip TypeScript types under `node_modules`, so a copy installed there cannot run the bin.

```text
s50 registry refresh                      lock the current top 50 into .s50/registry.lock.json
s50 feature <objective> [--consumer kind:path] [--criteria a;b] [--constraints a;b] [--non-goals a;b]
s50 bug <symptom> [same flags]
s50 frontend <objective> [same flags]
s50 issue <issue reference> [same flags]  starts behind /skill:triage
s50 survey <area> [same flags]            starts behind /skill:improve-codebase-architecture
s50 status                                objective, phase, revision, blockers, findings, nodes, stale count, next action, next gate
s50 resume                                read state, follow a new HEAD, print the next action
s50 verify                                evidence per acceptance criterion, the consumer route, every blocker
s50 explain                               the last 20 decisions and the next action
s50 apply '<command json>'                apply one coordinator command
s50 registry show | registry verify
```

Exit codes: 0 done, 1 error, 2 refused or a failing check, 3 accepted with the run now waiting on a human gate.

`--capabilities '<json>'` and `--installed a,b` override what the host reports. Inside Pi, the extension asks Pi which skills a session has loaded and whether a subagent tool (`subagent` or `Task`) is available. The shell asks Pi's resource loader which skills a session in that directory would load, and reports no independent agents.

Run state lives in `.s50/`. S50 creates `.s50/.gitignore` with `*` when it creates the directory, so run data stays out of Git. Delete that file to commit an audit trail; S50 does not recreate it.

## Gates

User-only upstream skills such as `/skill:triage` are never invoked by S50. The run blocks and names the command for the user to type.

When the model applies a command that records a user decision (`answer_decisions` with a user decision, `confirm_understanding`, `confirm_seams`, `grant_authorization`, `complete_user_workflow`), Pi asks the user first. Without a UI the tool refuses.

During a run, a bash command that force-pushes, merges a pull request, deploys, deletes data destructively, publishes a package, or posts a public message asks the user first. Without a UI it is blocked. The patterns live in `src/policy/authorization.ts`; a command they do not recognize is not stopped, so S50 also tells the agent to stop at these actions.

## Documentation

- [Architecture](docs/architecture.md) explains the coordinator, the data shape, persistence, the rejected designs, concurrency, and the Pi surfaces.
- [Workflows](docs/workflows.md) walks each route, separating upstream skill contracts from S50 policy, and documents the diagnostic-test exception.
- [Registry](docs/registry.md) covers the top-50 rule, the 2026-10-07 snapshot, and why install count is not a quality score.
- [Verification](docs/verification.md) covers evidence states, staleness, review independence, guideline digests, consumer routes, and redaction.

## Host-dependent capabilities

| Capability | Without it |
| --- | --- |
| Independent agents (a `subagent` or `Task` tool in Pi) | Reviews are stored as reduced assurance. |
| Independent agents plus isolated worktrees | Graph nodes run one at a time. |
| The `agent-browser` CLI | Browser and Electron verification is INCONCLUSIVE. |
| Native UI automation (declared with `--capabilities`) | Native verification is INCONCLUSIVE. |
| Network access to skills.sh and GitHub | `registry refresh` fails; `--from` locks offline. |
| A Pi UI | Commands that record user decisions and gated bash commands are refused. |

## Known limitations

- S50 records what the agent reports through commands. It cannot see inside files, so it trusts the agent's report that temporary instrumentation is gone or that a measurement ran.
- Bash authorization covers the command patterns in `src/policy/authorization.ts`. Customer communication and sensitive-data disclosure have no reliable command pattern and rely on the agent stopping.
- The `.s50/` write queue serializes calls inside one Pi process. Two shell processes that write the same `.s50/` at once can still race.
- `registry refresh` parses the leaderboard embedded in the skills.sh page. If skills.sh changes that format, the refresh fails and writes nothing.
- Installed skills are matched by name. A different skill with the same name, for example a local `tdd`, satisfies the gate; preflight records a risk when its content hash differs from the lock.
- `registry/skill-sources.json` pins the commits inspected on 2026-10-07. Offline `--from` locks use those pins; a live refresh resolves current upstream commits instead.
