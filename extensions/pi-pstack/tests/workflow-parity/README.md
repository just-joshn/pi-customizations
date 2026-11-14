# Workflow parity harness (spec phase 06)

One contract checker per workflow family. A checker reads only what a run leaves behind: the parent and worker Pi session files, `.pi/pstack/runs/<runId>/` (run.json, TODO.md, decisions.tsv, events.jsonl, workers/*, receipts), plan files, and the git state of a throwaway repository. It returns PASS, FAIL or SKIP per check with the evidence and the upstream source span it enforces. It asserts structure (which skills were read, TODO.md steps and states, worker roles, models and workspace modes, isolation, receipts, stop conditions, read-only families writing nothing), never prose wording.

Two drivers feed the same checkers. Both run the real `pi` binary over RPC in a temp git repository and send the real slash command.

- Scripted: `fixtures/scenario-model.ts` replays a scenario as the model's answers. Pi, the pstack extension, the tmux workers and the files are real. This proves the harness and that each checker passes a conforming run and fails each violating one.
- Real model: the same scenario prompt, with `PSTACK_E2E_REAL_MODEL=<provider>/<id>` choosing the model for every role. `PSTACK_E2E_REAL_MODEL_B` gives the panel roles a second family. Credentials are copied from `PSTACK_E2E_AGENT_DIR` (default `~/.pi/agent`).

## Commands

```sh
# every family, scripted, through vitest
npx vitest run tests/workflow-parity

# one family, scripted, with its checker table and its negative cases
node --disable-warning=ExperimentalWarning tests/workflow-parity/run-family.ts feature

# one family on a real model, with the checker table
PSTACK_E2E_REAL_MODEL=deepseek/deepseek-flash node --disable-warning=ExperimentalWarning tests/workflow-parity/run-family.ts feature --real

# the same through vitest
PSTACK_E2E_REAL_MODEL=deepseek/deepseek-flash npx vitest run tests/workflow-parity/build.test.ts -t feature
```

## Benny live application evidence

`tests/automation/benny-live.test.ts` runs a scripted Pi worker through the real Benny completion path. It uses fake Slack and tracker fixtures, plus a local git mirror of Real World App PR #5. It never pushes to the public application repository.

The app cache defaults to `~/pstack-runs/app-cache/realworld-app`. It must contain commits `39d86229dd9966a441821d85fed11bb6d01bac57` and `035b8d947f86fbbe666efa1e7fa8d8ca358af393`, installed dependencies, and the app's checked-in react-virtualized dependency patch applied by its postinstall. The fixture archives each commit into a separate temporary directory and seeds it from that commit's `database-seed.json`. Cached source edits cannot change either build. Node 24 must be installed through mise or selected with `PSTACK_RWA_NODE`. Playwright defaults to `~/.cache/verify-rwa/node_modules/playwright`, overridable with `PSTACK_RWA_PLAYWRIGHT`. Its Chromium executable must already be installed. `PSTACK_RWA_CACHE` overrides the cache location. None of these dependencies are downloaded by the test.

Run the local proof with an external temporary directory:

```sh
TMPDIR="$HOME/pstack-runs/u55" PSTACK_RWA_KEEP_EVIDENCE=1 npx vitest run tests/automation/benny-live.test.ts
```

The retained directory contains server identities, server logs, an independent API gateway log, the worker transcript, two browser traces and paired screenshots and DOM captures per build. Entering `12.34` produces `Paid $12.00` and a stored amount of `1200` on the baseline. The patched build produces `Paid $12.34` and stores `1234`.

The reusable control adapter is `tests/automation/rwa-fixture.cjs`. Its `serve <cache> <output> <commit>` command starts an independently owned API, recording gateway and Vite build on free localhost ports. It prints the server identity when ready. Its `drive <server.json> <playwright-module> <output>` command drives two fresh Chromium sessions. Set `PSTACK_RWA_CHROMIUM` to the installed browser's absolute executable path when the worker has an isolated HOME. Its `record <baseline-output> <patched-output> <artifact-directory>` command writes the ordinary Benny proof record. The server owner stops the manager with SIGTERM after the worker finishes.

A later real-model Benny family can use these same commands and `rwa-evidence.ts` checkers. Keep server ownership in the driver, give the model the fake thread and tracker files and local mirror ref, and expose only the local control commands. Audit actual successful tool results with `auditLiveWorker`, not commands copied from a prompt. The existing `run-family.ts` registry does not yet have a Benny entry. Registering that entry and supplying explicit model credentials are still needed to run it through that real-model runner. The current proof establishes the deterministic worker path, not a real model's compliance rate.

On cacheless Linux CI, the live test skips with the missing prerequisite in its reason. It does not pass. The requirements link that test, so Linux-only evidence leaves both requirements INCONCLUSIVE. The manifest can merge a local passing run with CI results and records `resultsSource: local`. `check-release.mjs` still checks the recorded source digest and clean-tree identity, and every mandatory requirement must be PASS.

## Inconclusive runs and exit codes

A real-model run reports only what it observed. After the run the harness reads every assistant message in the parent and worker sessions. A run is INCONCLUSIVE, not scored, in three cases.

- `provider-error`: an assistant message has `stopReason: "error"` or an `errorMessage` (429, auth, model not found). The first error text is printed.
- `no-activity`: the parent made no tool call and produced no reply.
- `crash`: the family's `drive` hook threw. meta.json records `crashed: <message>`, `sandbox kept: <dir>` is printed, and the sandbox stays on disk.

An inconclusive run prints `== <family> (real driver): INCONCLUSIVE <kind>: <message> ==`, skips the checker table and the negative cases, and records `inconclusive` in meta.json and the evidence record. A `drive` hook records a wait that timed out with `api.finding(...)` instead of throwing. Findings go to meta.json and the report.

A check whose PASS rests on an action not happening (no merge, no ref update, no tool errors, no writes) is built with `checkAbsence` (or wrapped with `absence`) in `lib/check.ts`. It is INCONCLUSIVE unless the parent completed without error and made at least one tool call.

Exit codes of `run-family.ts`: `0` every check passed, `1` a check failed or a negative case was missed, `2` usage, `3` INCONCLUSIVE.

`--real` preflights each model the run uses (`PSTACK_E2E_REAL_MODEL`, `PSTACK_E2E_REAL_MODEL_B`) with one tiny request, the same one as `--model-check`, before building any sandbox. A provider error stops with exit 3. `--stop-on-provider-error` stops an `all` batch at the first provider-error run. A batch loop that stops on exit 3:

```sh
for family in feature babysit-drive babysit-restart; do
  node --disable-warning=ExperimentalWarning tests/workflow-parity/run-family.ts "$family" --real
  [ $? -eq 3 ] && { echo "inconclusive at $family: batch stopped"; break; }
done
```

`run-family.ts all --real --stop-on-provider-error` does the same inside one process.


`--keep` leaves the sandbox on disk. Each run writes an evidence record (the table, the sandbox path, the negative-case results) to `$PSTACK_E2E_EVIDENCE_DIR`, default `$TMPDIR/pstack-workflow-parity`.

`CHECKS.md` lists every check with the upstream source span it enforces and every negative case. Regenerate it with `node --disable-warning=ExperimentalWarning tests/workflow-parity/list-checks.ts > tests/workflow-parity/CHECKS.md`.

## Layout

- `lib/` the loader (`view.ts`), the drivers (`driver.ts`), the check library (`checks.ts`), the mutation helpers for negative cases (`mutate.ts`), and `define.ts` for vitest.
- `families/` one file per group of families: its scenario, its checks with source spans, and its negative cases.
- `fixtures/` the scenario model, the scenario builders, the receipt helper and the controlled repositories.

Where a skill allows more than one branch (how's simple or complex path, why's inline answer, teach running only how or only why, arena's skipped judge, swarm's container or worktree workers), the checker detects the branch the run took from what it left behind and holds the run to that branch's contract. A case with `passes` moves the finished sandbox to another allowed branch and requires the named checks to still PASS.

The driver reports a pi that crashed, hung, or left no session as that, with pi's stderr tail. Sandboxes live under `$TMPDIR/pstack-parity-<hash of this checkout>/`, so a cleanup that sweeps another checkout's `pstack-wf-*` sandboxes cannot reach them.

A negative case copies the finished sandbox, breaks one thing in it (skips a TODO step, writes during a read-only run, forges a receipt, lets two writers share a worktree), and requires the named checks to FAIL.

## PR workflows and the fake forge (spec phase 07)

`fixtures/forge.ts` and `fixtures/forge-cli.mjs` give the PR families a stateful forge. `setupForge` builds a local bare `origin`, pushes the fixture branches, and puts a fake `gh` (and, with `originCli`, a fake `origin`) first on the run's PATH through `RunSpec.env`. Every PR, check wave, review thread, comment, merge-queue and merge fact lives in `<origin.git>/forge/state.json`. Every CLI call and every ref update (a pre-receive hook in the bare repository, which records the pushing worker, container flag and simulated operator) is appended to `forge/actions.jsonl`, so a checker asserts "no unauthorized merge", "no rebase" or "no force-push" from the artifact. Real git decides head SHAs, conflicts (`git merge-tree`) and merges. A scripted `events` rule makes the simulated operator rebase a stack or advance trunk at a chosen moment. The real `watch-pr` runs against it unchanged.

Container workers (verifiers, owners) run in real containers on the local engine: `forgeEnv` pins the engine, hands them the forge token through `PSTACK_CONTAINER_FORGE_TOKEN`, and loads the scripted model through `PSTACK_CONTAINER_PROVIDER_PACKAGES` (`fixtures/sim-provider`) with the scenario beside it. They reach the forge through `node forge-cli.mjs gh ...` by absolute path, because the container's PATH is the image's. Commits made by a scripted owner are reproducible (`COMMIT_PREFIX`), so `predictCommits` names a head SHA before the owner exists.

Families: `pr-babysit.ts` (drive, check, docs-only, threads-only, queued, origin, background, single-watcher), `pr-shipping.ts` (shipping, shipping-freshness, shipping-no-engine, shipping-no-forge-token), `pr-autopilot.ts` (autopilot-full, autopilot-hold, autopilot-stack), `pr-orchestrate.ts`, and `pr-review.ts` (opening-a-pr, pr-review-triage, worktree-cleanup-authorize).

Real model for one family, for example `PSTACK_E2E_REAL_MODEL=deepseek/deepseek-flash node --disable-warning=ExperimentalWarning tests/workflow-parity/run-family.ts babysit-drive --real`. The container families need a container engine and a real provider Pi can load inside the container, so run them on a model with a stored credential and a package the container can mount (`PSTACK_CONTAINER_PROVIDER_PACKAGES`).

## PR workflows on a real forge (opt-in)

`fixtures/real-forge.ts`, `families/pr-real-forge.ts` and `lib/real-run.ts` run `babysit-drive-real`, `shipping-real` and `opening-a-pr-real` against a throwaway GitHub repository (`just-joshn/pstack-parity-sandbox`, or `PSTACK_REAL_FORGE_REPO`). Each run pushes a fresh trunk and branch set under `pf/<stamp>/<family>/`, opens real PRs, and relies on a workflow committed with the fixture history (`.ci-mode` on a branch picks pass, fail or a flake that passes on rerun). The scripted model drives the real `pi` binary, `gh` is the real one (the parent gets the operator's token in `GH_TOKEN`, a container worker gets it through `PSTACK_CONTAINER_FORGE_TOKEN`), and the real `watch-pr` runs unchanged. After the run, `RealForge.capture` reads the repository's state from the GitHub API into `real-facts.json`. The fact checks are pure functions of those facts. Negative cases break one fact, or one thing in the parent's session, and must be caught. The run then closes its PRs and deletes its branches (`RealForge.cleanup` sweeps by prefix, so it is safe after a crash and safe to repeat).

It is opt-in so the merge gate stays offline: `PSTACK_REAL_FORGE=1 npx vitest run tests/workflow-parity/real-forge.test.ts -t "real forge live"`, or `node --disable-warning=ExperimentalWarning tests/workflow-parity/run-real-family.ts <family> --record`. The committed records in `real-forge-evidence/` and `docs/real-forge-evidence.md` (rendered by `render-real-evidence.ts`) are re-checked offline by the replay tests in the same file. `tests/container/real-github.test.ts` is the opt-in proof that a container worker pushes to github.com.

## Known product defects, asserted with `test.fails`

See `knownDefects` in `families/design.ts` (swarm) and `families/meta.ts` (eval).
