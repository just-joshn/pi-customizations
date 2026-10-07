# pi-s50

S50 takes a feature, bug, or frontend change to `PR_READY` in Pi, and refuses to say `PR_READY` while any required evidence is missing, stale, failed, or inconclusive. A deterministic coordinator owns every rule. The agent only routes. External skills are limited to the skills.sh all-time top 50 at the moment the registry is locked.

## Install

```bash
pi install ./extensions/pi-s50
```

The package ships one extension (`src/index.ts`), one skill (`skills/s50`), and the inspected skill-source file (`registry/skill-sources.json`). S50 calls external skills that you install separately, for example:

```bash
npx skills add mattpocock/skills --skill grilling
```

When a run needs a skill you have not installed, it stops with a `missing_skill` gate that names the install command.

## Use

The same commands work in a shell, as `/s50` in Pi, and through the model's `s50` tool:

```text
s50 registry refresh                 lock the current top 50 into .s50/registry.lock.json
s50 feature <objective> [--consumer kind:path] [--criteria a;b]
s50 bug <symptom> [...]
s50 frontend <objective> [...]
s50 status                           objective, phase, revision, blockers, findings, nodes, stale count, next action, next gate
s50 resume                           re-read state, detect a new HEAD, print the next action
s50 verify                           evidence per acceptance criterion and the consumer route
s50 explain                          the decision log
s50 apply '<command json>'           apply one coordinator command
s50 registry show | registry verify
```

Run state lives in `.s50/`. A `.s50/.gitignore` keeps it out of Git. Delete that file to commit an audit trail.

Commands that only the user may approve (`confirm_understanding`, `confirm_seams`, `grant_authorization`, `complete_user_workflow`) open a confirmation dialog when the model applies them. User-only upstream skills such as `/skill:triage` are never invoked by S50. The run blocks and names the command for you to type.

S50 never merges, deploys, force-pushes, publishes, or sends messages on its own. Each of those needs an exact `grant_authorization` for the action and scope.

## Documentation

- [Architecture](docs/architecture.md) explains the coordinator, the data shape, persistence, the rejected design, and concurrency.
- [Workflows](docs/workflows.md) walks each route, marking upstream contract facts apart from S50 policy, and documents the diagnostic-test exception.
- [Registry](docs/registry.md) covers the top-50 rule, the 2026-10-07 snapshot, and why install count is not a quality score.
- [Verification](docs/verification.md) covers evidence states, staleness, review independence, guideline digests, consumer routes, and redaction.

## Known limitations

- Pi has no built-in independent subagent, so S50 serializes graph nodes and labels reviews as reduced assurance unless `--capabilities` reports a host that has them.
- Browser and Electron verification needs the `agent-browser` CLI. Without it the route is `INCONCLUSIVE`. It was not installed on the machine where S50 was built.
- Native application verification has no driver here and is always `INCONCLUSIVE`.
- Project-local install (`pi install -l`) loads only after you trust the project in an interactive session. Print mode does not load an untrusted project package.
- The registry refresh parses the skills.sh page's embedded leaderboard. If skills.sh changes that page format, refresh fails closed with `initialSkills payload not found` and writes nothing.
- `registry/skill-sources.json` records the commits and hashes inspected on 2026-10-07. A newer upstream revision is not picked up until that file is refreshed by hand.
