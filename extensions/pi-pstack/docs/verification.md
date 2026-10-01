# Verification

## Current audit evidence

The current parity audit remains **NOT VERIFIED**. The [compatibility report](parity.md) lists outstanding host requirements. Local checks do not prove hosted execution, credential isolation, or instruction adherence.

The audit prohibits subagents. Its allowed real RPC suite passes 427 assertions with zero findings. The suite also checks that recorded requests do not invoke `Task`. Actual Task startup, resume, steering, and descendant execution remain unverified by this audit.

Fresh checks verify the following contracts:

- `bun run check:resources` verifies 187 upstream files and 205 generated resources.
- `bun run typecheck` passes against the package's pinned Pi SDK 0.99.2.
- `bun run check:cli` verifies installed CLI package loading, RPC commands, status, mode off, and orderly shutdown without model calls.
- `bun run check:upstream` passes 58 helper tests with 261 assertions in a temporary copy. These are deterministic helper checks, not live GitHub operations.
- `bun pm pack --dry-run` passes. A package dry run does not verify an extracted package's runtime.
- `bunx vitest run test/cli.test.ts` passes five distribution checks, including loading an extracted package through the real installed CLI. The inventory check permits only the documented `upstream/.gitignore` packer omission.

The terminal harness passes ten journeys at 120 and 70 columns. Five cover question selection, text, and cancellation. Five cover setup budget cancellation, declined write confirmation, accepted write confirmation, editing `bug-fix` to `inherit-parent`, and a two-seat panel containing duplicate `inherit-parent` aliases. Fixture commands invoke the production handlers with the real Pi UI. Budget cancellation creates no configuration. Declined confirmation leaves the seeded file unchanged. Accepted confirmation writes the selected small budget and preserves all 17 roles. Panel editing preserves both duplicate seats in the saved configuration. Model-mediated tool dispatch, provider-model selection, and the optional verification offer remain unverified through the terminal. Persisted panel seats do not establish worker execution or model adherence. It makes no inference calls and creates no subagents.

The current cloud lifecycle regressions use saved records, idle transport processes, or a main-session SDK fixture with a mocked launch boundary. The latest focused run passes 19 tests. The fixtures do not launch AI workers.

Cloud launch requests a macOS restriction on reads of known coordinator stores. Real idle transport tests verify blocked store byte reads and directory listings while allowing exact store-root metadata for canonicalization. Nested policy preparation succeeds. Applying a second sandbox from the restricted process fails with `sandbox_apply: Operation not permitted` on the tested macOS host. The test records that platform limit, not nested cloud parity. Unsupported platforms fail explicitly. Complete hosted filesystem and credential isolation remain unverified.

Evidence is retained in `/tmp/pstack-e2e-evidence`. The current logs include `fresh-resources.log`, `fresh-typecheck.log`, `fresh-cli.log`, `fresh-upstream.log`, `fresh-pack.log`, `fresh-packaged-cli.log`, and `cloud-startup-verification.log`. The real RPC results are in `full-rpc/results.json`.

## Reproduce the no-subagent audit

From the repository root, run the allowed real RPC suite:

```sh
node extensions/pi-pstack/scripts/verify-journeys.mjs extensions/pi-pstack --no-workers /tmp/pstack-e2e-evidence/full-rpc
```

From `extensions/pi-pstack`, run the focused lifecycle checks:

```sh
bunx vitest run test/cloud-startup.test.ts test/cloud-directory.test.ts test/cloud-filesystem.test.ts test/cloud-record-control.test.ts test/detached-rpc.test.ts
bun run check:resources
bun run typecheck
bun run check:cli
bun run check:upstream
bun pm pack --dry-run
bunx vitest run test/cli.test.ts
```

The source census inventories supplied authoritative paths without changing them. It hashes regular files and retains every nonblank Markdown line with its line number and an `UNREVIEWED` state. It excludes `.git`, `node_modules`, and `.DS_Store` entries and does not follow symbolic links. Non-Markdown behavior still requires code review and execution. The census always reports `NOT VERIFIED`; extraction is not a requirement verdict or proof of parity.

```sh
node extensions/pi-pstack/scripts/source-census.mjs /path/to/authoritative/source [...] > /tmp/source-census.json
```

The current nine-root census contains 166 source entries, including all 158 pstack files, and 9,906 nonblank Markdown review units. Headings, examples, and metadata are included, so this is not a count of requirements. Those units still need semantic grouping and evidence mapping before a requirement-level completion audit can pass.

The generated worktree audit accepts an optional second argument for a custom Pi session directory. Without that argument, it honors `PI_CODING_AGENT_SESSION_DIR` and expands a leading `~/` using HOME. Regressions cover argument precedence over the environment and both absolute and tilde-prefixed environment paths. A real Bash/Git regression reproduces missing recent-chat evidence without this argument and verifies `verify-recent-chat` when the directory is supplied. Default workspace and child transcript discovery remains covered. A second reproduced defect split custom directory names containing spaces and reported an epoch-era date. Null-delimited filename transport fixes that failure. Both plain and spaced custom directories now report the recent session date. The helper never deletes worktrees and does not prove that pruning any worktree is safe.

```sh
bash extensions/pi-pstack/skills/poteto-mode/scripts/worktree-audit.sh /path/to/repo /path/from/the/host/session/contract
```

With `tmux` and the installed `pi` CLI on PATH, run the terminal question journeys from the repository root:

```sh
node extensions/pi-pstack/scripts/verify-question-tui.mjs /tmp/pstack-e2e-evidence/question-tui-maintained
```

The harness uses a temporary agent directory and working directory. It records terminal captures and literal returned answers, then stops its terminal process. It does not approve the repository trust dialog or alter your personal Pi configuration.

The unrestricted test suite includes worker execution. Do not run that suite under the audit's no-subagent constraint.

## Historical verification

The [comprehensive audit](comprehensive-audit.md) and the results below describe earlier verification runs. Their SDK versions, discovery counts, coverage percentages, and delegation results are historical, not results of the current no-subagent audit.

### Historical source and host contracts

The resource checker verifies all 187 upstream hashes and all 205 generated resources, including executable bits. The official Pi loader discovers 65 legal skill names and 64 prompt templates, including the Pi-authored loop skill and `/loop` template. Benny's three operational skills remain outside discovery. The [mechanism audit](mechanism-audit.md) records the current checks and invocation changes.

The TypeScript compiler checks the implementation against pi SDK 0.87.1. Integration tests use the real resource loader, extension runner, session manager, and agent sessions with a deterministic local provider. They make no paid model calls.

The real installed pi CLI also passes `scripts/verify-cli.mjs`. That check starts an isolated RPC process, discovers commands, invokes status and mode-off commands, observes the custom status message, and verifies orderly shutdown.

The upstream helper suite passed 52 tests with 206 assertions across orchestration and PR watcher tests. It ran from a temporary copy with the original frozen Bun lockfile so the vendored tree remained unchanged.

The packed inventory contains every tracked file the manifest declares except `upstream/.gitignore`. `bun pm pack` drops a file with that name even though `files` lists it explicitly, so the published tarball is one entry short. `test/cli.test.ts` asserts the omission is exactly that one entry, so a wider loss fails the suite.

### Historical local check commands

Run from `extensions/pi-pstack`:

```sh
bun install
bun run check:resources
bun run typecheck
bun run test
bun run test:coverage
bun run check:cli
bun pm pack --dry-run
```

To run the preserved helper tests without changing the snapshot, copy `upstream/skills/poteto-mode/scripts` to a temporary directory. In that copy, run `bun install --frozen-lockfile` and `bun test orch watch-pr`.

### Historical limits

No live multi-provider model comparison, paid provider inference, external service integration, interactive terminal dialog journey, cloud deployment, or Benny automation was run. Model setup dialogs have behavioral tests using scripted user answers. The same-family review is independent for the stated code scope but does not satisfy pstack's requested cross-family reviewer diversity.

The completion predicate for full runtime parity remains NOT VERIFIED because the [compatibility report](parity.md) lists unmet host contracts. Passing local tests does not remove those gaps or prove universal instruction adherence.

The original pstack increment finished with 17 passing tests. The real nested-worker test proves active descendants are cancelled on both terminal completion and TaskStop, with no later writes after their scheduled completion time. Those checks remain in the expanded suite.

## Historical mechanism audit verification

The mechanism-audit suite passed 38 tests before the comprehensive audit. `npm run test:coverage` uses pinned `c8` 12.0.0 and reports 93.31% lines and statements, 80% branches, and 98% functions. It enforces an aggregate 80% minimum in all four categories and includes all runtime source files. `coverage/` is generated and ignored.

The native Node 26.10.0 coverage merger initially reported 73.11% lines and marked model setup code uncovered despite passing isolated setup tests with 96.15% coverage. The current command uses a source-map-aware reporter. Additional SDK tests verify successful setup and its once-only offer, question answers and cancellation, task message delivery and cancelled waits, invalid todo rejection, and complete structured context behind truncated text. See the [audit report](mechanism-audit.md) for the comparison and review limits.

## Historical team-kit increment

These results describe the pre-audit implementation at `91946b769c398ddd66cef9a085c600f05ba61fa6`. The mechanism audit supersedes its skill counts and alias implementation. The source helper results above are also retained historical evidence; unchanged helper code does not require rerunning those tests for this migration.

The new integration checks initially failed on the old implementation. Discovery returned 47 instead of 65 skills, and the expected always-on rule section was empty. After implementation, the full suite passed 28 tests with zero failures. TypeScript and resource verification passed against official pi 0.87.1.

| Contract | Evidence and limit |
| --- | --- |
| Skill dependency closure | Real SDK discovery finds all 18 literal kit names. Alias and native invocations for deslop, control-cli, and control-ui carry their source instructions and user arguments. |
| Source and assets | All 187 hashes and 143 generated resources pass. Canvas HTML, CSS, and renderer equal their source files. The pstack snapshot has no changes. |
| Generator failure behavior | Temporary copies show source corruption and overlapping destinations fail before any generated skill is overwritten. A generation rerun leaves the resource map unchanged. |
| Rule delivery | Actual parent and writable-child requests contain both rule bodies. Parent rules remain after Poteto mode is disabled. |
| Readonly rule delivery | The test observes the actual SDK resource loader during readonly child construction and sees both rules and the full review rubric with extensions disabled. That historical fixture failed because its extension-only provider was absent. The comprehensive audit now copies only the selected provider registration and verifies completed readonly turns with extension tools disabled. |
| Kit personas | Actual writable child requests contain the CI persona or complete review rubric. Missing `fast` fails, explicit model succeeds, and resume retains its concrete model. Unsupported shell and explore requests fail explicitly. |
| CLI and distribution | The RPC check passes against the working package and an extracted npm tarball. Both report 65 aliases and the kit version without model calls. The package inventory contains all 330 preserved and generated resources. |
| Coverage | Node's coverage report over `src/*.ts` reports 91.73% lines, 75.42% branches, and 80.88% functions across the full suite. |

Coverage command:

```sh
node --import tsx --test --experimental-test-coverage --test-coverage-include='src/*.ts' test/*.test.ts
```

To check an extracted package through the real CLI, run `bun run check:cli -- /absolute/path/to/extracted/package` from this development directory. The script uses the installed official CLI with the extracted package as its extension source. It does not install the package globally.

The source's local control-cli workflow informed this reuse of the existing isolated RPC harness. Interactive terminal rendering, actual GitHub CI, browser automation, and stochastic workflow compliance were not exercised. Full parity remains unverified.
