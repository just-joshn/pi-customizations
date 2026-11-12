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

`--keep` leaves the sandbox on disk. Each run writes an evidence record (the table, the sandbox path, the negative-case results) to `$PSTACK_E2E_EVIDENCE_DIR`, default `$TMPDIR/pstack-workflow-parity`.

## Layout

- `lib/` the loader (`view.ts`), the drivers (`driver.ts`), the check library (`checks.ts`), the mutation helpers for negative cases (`mutate.ts`), and `define.ts` for vitest.
- `families/` one file per group of families: its scenario, its checks with source spans, and its negative cases.
- `fixtures/` the scenario model, the scenario builders, the receipt helper and the controlled repositories.

A negative case copies the finished sandbox, breaks one thing in it (skips a TODO step, writes during a read-only run, forges a receipt, lets two writers share a worktree), and requires the named checks to FAIL.

## Known product defects, asserted with `test.fails`

See `knownDefects` in `families/design.ts` (swarm) and `families/meta.ts` (eval).
