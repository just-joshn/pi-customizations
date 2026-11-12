# Rebuild contract

Every worker on `pstack/native-rebuild` builds against this file. `specification.md` (same folder) is the requirement. This file fixes the names and shapes the specification leaves open, so parallel units agree. Change it only through the coordinator.

Package root: `extensions/pi-pstack`. All paths below are relative to it unless absolute.

## Layout (spec section 6)

New code lands beside the old code until the cutover unit. Do not edit or delete existing `src/*.ts`, `test/`, or `skills/` in wave 1. The cutover unit switches `package.json` `pi.extensions` to `./src/extension.ts`, `pi.skills` to `./generated/skills`, adds `pi.prompts`, and deletes the old runtime.

| Path | Owner unit |
| --- | --- |
| `vendor/upstream-pstack/`, `vendor/upstream-cursor-team-kit/` | U01 source freeze |
| `scripts/sync-upstream.mjs`, `scripts/check-dependencies.mjs`, `scripts/compile-skills.mjs`, `scripts/check-parity.mjs` | U01, U03 |
| `adapters/*.ts`, `generated/**` | U03 compile pipeline (U04b owns `adapters/model-config.ts`) |
| `src/worker-host.ts`, `src/rpc-client.ts`, `src/workers.ts`, `src/run-files.ts`, `src/evidence.ts` | U04a workers |
| `src/models.ts`, `adapters/model-config.ts`, `scripts/start-run.mjs` | U04b models and TODO.md |
| `src/forge.ts` | U07 forge |
| `src/extension.ts`, `src/commands.ts`, `src/skill-routing.ts` | U04c integration and cutover |
| `tests/<area>/*.test.ts` | the unit that owns the area |

New tests live under `tests/`. Run them with `npx vitest run tests/<area>` from the package root. Add `tests/**/*.ts` to `tsconfig.json` `include` only in U04c. Until then, typecheck new files with `npx tsc --noEmit -p tsconfig.json` after adding your own paths to a local, uncommitted copy, or with a unit-local `tsconfig.<unit>.json` that extends the package one.

## Upstream pin

`https://github.com/cursor/plugins` at `5866df557357d005b3c0c9d3da0d9e739b4bdde3`, paths `pstack/` and `cursor-team-kit/`. Expected inventory: 58 skill directories under `pstack/skills` (34 primary, 24 `principle-*`), 23 files under `pstack/skills/poteto-mode/playbooks`, 2 agents under `pstack/agents`, the Benny pack under `pstack/automations`.

## Identifiers

`RunId` and `WorkerId` match `^[a-z0-9][a-z0-9-]{0,39}$`. Validate at every boundary.

tmux uses its own server: always `tmux -L pstack`. Session name `pstack_<runId>_<workerId>_<hash>`, where `<hash>` is the first 8 hex digits of sha256 of `<project>\0<runId>\0<workerId>`. Ids never contain `_`, so the parts cannot run together, and the hash keeps two projects apart on the one server. When the host does not answer, abort ends the session only after `#{pane_pid}` of its single pane equals the `hostPid` in the worker's `claim/identity.json`; otherwise it reports `refused` and leaves the session running. Never call `kill-server` outside tests. Tests use `-L pstack-test-<random>` and may kill only that server.

## Run files (spec 7)

Run root: `<project>/.pi/pstack/runs/<runId>/`. `<project>` is the git toplevel of the parent's cwd, or the cwd outside git.

```
run.json            { schemaVersion: 1, runId, title, playbook, upstreamRevision, createdAt, parentSessionFile|null, inputCommit|null }   // null: an automation run, owned by its automation adapter, not a chat
TODO.md             parent is the sole writer
decisions.tsv       show-me-your-work format: ts, phase, decision, why, evidence, result
events.jsonl        append-only; extension and hosts append { ts, runId, workerId?, kind, data }
workers/<workerId>/
  assignment.json   immutable after creation (schema below)
  brief.md          the worker's self-contained brief, written by the parent
  claim/            created exclusively by the host; its presence forbids a second host
  control.sock      host control socket, mode 0600 (if the path exceeds 100 bytes, the host uses /tmp/pstack-<uid>/<sha256(runDir)[0..16]>-<workerId>.sock and records it in state.json)
  state.json        host-written snapshot; never a liveness oracle
  report.md         written by the worker
  evidence/         receipts written by the worker
  worktree/         git worktree for writable workers
verification/receipts/<id>.json   one file per receipt, created with O_EXCL; no shared file, no lock. The verdict list is derived by reading the directory.
```

Write JSON atomically (temp file plus rename). Plans live in `<project>/.pi/pstack/plans/<slug>.md`.

## Assignment (`assignment.json`)

```ts
{
  schemaVersion: 1,
  runId: RunId,
  workerId: WorkerId,
  kind: 'pi' | 'watch',
  role: 'poteto' | 'explorer' | 'investigator' | 'candidate' | 'judge' | 'verifier' | 'reviewer' | 'owner' | 'watcher' | 'comment-sicko' | 'general',
  brief: 'brief.md',                 // relative to the worker dir; kind 'pi' only
  model: 'inherit-parent' | '<provider>/<id>',
  thinkingLevel: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max' | null,
  workspace: { mode: 'worktree', inputCommit: string }   // writable: extension creates worktree/ at inputCommit
           | { mode: 'readonly', path: string }           // absolute; tools: read,grep,find,ls,bash_readonly (+MCP per capabilities)
           | { mode: 'container', inputCommit: string },  // writable clone inside the configured container (.pi/environment.json); refused with ContainerUnavailable until the container unit lands
  skills: string[],                  // skill names the brief requires the worker to read first
  watch?: { argv: string[], cwd: string }   // kind 'watch': argv runs in tmux; exit wakes the parent
}
```

Optional with defaults (applied by `parseAssignment` and written back before the claim, so the stored assignment is complete): `schemaVersion` 1, `kind` 'pi', `skills` [], `thinkingLevel` null, `capabilities` per role, readonly `workspace.path` and `watch.cwd` the project root. `generated/skills/poteto-mode/references/worker-assignment.md` holds one complete example per workspace mode and kind, and a test parses every example with the real parser.

`role` selects a role instruction document from `generated/agents/<role>.md` (U03 produces `poteto.md` and `comment-sicko.md` from upstream agents; other roles use `general.md`).

## Tools (spec 8.4)

Exactly two model-facing tools, TypeBox-validated.

`pstack_worker`:

- `{ action: 'spawn', runId, assignmentPath }`. Validates the assignment and its path (must be `<runRoot>/workers/<workerId>/assignment.json`). Resolves the model. Starts `tmux -L pstack new-session -d -s <session name> -- node <pkg>/dist-or-src/worker-host entry <assignment>`. The host creates the worktree after it takes `claim/`, so only the claim holder creates it. It creates a new branch `pstack-run/<runId>/<workerId>` at `inputCommit`. An existing `worktree/` path, or an existing branch of that name, fails the host; nothing is reused. Waits for the host handshake. Sends the brief as the first prompt. Returns `{ workerId, tmuxSession, attach: 'tmux -L pstack attach -t <session>', sessionFile, model }` immediately. Refuses when `claim/` exists.
- `{ action: 'inspect', workerId, runId }`. Live host state, or `unavailable` with reason.
- `{ action: 'steer', workerId, runId, message }`. RPC `prompt` with `streamingBehavior: 'steer'`: it joins the active run, or starts one when Pi is idle. RPC `steer` sent as a run ends would queue behind a run that never starts.
- `{ action: 'abort', workerId, runId }`. clear_queue, abort, then orderly shutdown of that host only.
- `{ action: 'collect', workerId, runId }`. Final state, `report.md`, final assistant text from the native session file, evidence file list. A worker that is not settled returns its live state, never a result. Settled means the latest settle covers the latest work generation: the host counts each prompt, steer, or follow-up it forwards as a generation and persists it in `state.json` before forwarding. A run's settle covers the generations acknowledged before the `get_state` answer that found Pi quiescent (see Runtime invariants), and the host ending covers all of them. A host that is gone with a generation no settle covers returns no result.

`pstack_evidence`:

- `{ action: 'record', runId, receiptPath }`. Validates a receipt under the run root and stores it as `verification/receipts/<id>.json`: the recorder writes a private temporary file and hard-links it to that name, so the name never holds a partial receipt and concurrent recorders share no file and take no lock. Recording an id that exists is idempotent when the receipt is identical (deep equality of the receipt object) and an error when it differs. `verify` and `list` read the directory.
- `{ action: 'verify', runId, target }`. Re-checks every receipt for `target` (a TODO step id, worker id, or commit): files exist, sha256 match, `commit` equals the target commit when given. Returns `pass`, `fail`, or `inconclusive`. A missing receipt is `inconclusive`, never `pass`.
- `{ action: 'list', runId }`.

Receipt:

```ts
{ schemaVersion: 1, id: string, runId: RunId, target: string, kind: 'test'|'command'|'screenshot'|'trace'|'review'|'measurement'|'other',
  verdict: 'pass'|'fail'|'inconclusive', commit: string|null, environment: string,
  command?: string[], exitCode?: number, artifacts: { path: string, sha256: string }[], defects?: string[], reason?: string, createdAt: string }
```

## Wakeups (spec 9.1, 11.3)

While a parent session is live, the extension watches its run's hosts. When a worker settles (idle after work, failed, aborted, unavailable) or a `watch` worker exits, it posts one `pi.sendMessage({ customType: 'pstack-worker', content, display: true }, { triggerTurn: true, deliverAs: 'followUp' })` per transition, with `details: { transitionId, runId, workerId, phase }` where `transitionId = <workerId>:<host instance>:<settle sequence>`. The parent session file is the delivery record: Pi persists each `sendMessage` as a `custom_message` entry with its `details` (docs/session-format.md; observed for `pstack/shell`). Before sending, and on every reconcile, the extension scans the active branch, `ctx.sessionManager.getBranch()` (root to current leaf), for `custom_message` entries of type `pstack-worker` and sends only transitions whose id is absent. Delivery is defined against the active branch: after `/tree` moves the leaf above a wake, the parent model no longer sees it, so it is sent again on the new branch. The in-memory record of wakes handed to Pi but not yet persisted is cleared on every `session_start` and `session_tree`.

Fork policy: a run's owner is the session file in its `run.json`, and a fork or clone does not change it. The forked session has a new file, so it gets no wakes and cannot control the run's workers. The original session gets them when it is reopened. To hand a run to a fork, the parent writes a new run. `events.jsonl` logs the attempt for audit only and is not consulted for delivery. The host keeps every settle in `state.json`, so a settle is never dropped before a parent sees it. At 10,000 settles the host refuses new work with an error instead of dropping one. The extension marks a wake sent only after `sendMessage` returns, so a throw leaves it for the next poll. On `session_start` the extension reconciles `run.json` files whose `parentSessionFile` matches, against `tmux -L pstack list-sessions`. A missing session with no settled state is reported `unavailable`, never complete.

## Worker process

The host runs `pi --mode rpc` in the worker's workspace with `--model`, `--thinking`, `--session-dir <workerDir>/session`, `--append-system-prompt <generated/agents/<role>.md>`, env `PSTACK_WORKER=1`, `PSTACK_RUN_ID`, `PSTACK_WORKER_ID`, and the user's normal Pi resources (extensions, skills, MCP) so pstack skills and MCP are available. With `PSTACK_WORKER=1`, the pstack extension registers only `pstack_evidence`, and no `pstack_worker`. Readonly workers get `--tools read,grep,find,ls,bash_readonly` plus MCP tools per capabilities. `bash_readonly` is the existing OS-sandboxed read-only shell (`src/readonly-shell.ts`, with the macOS sandbox and the Linux seccomp filter): it allows reads and network reads such as `git log` and `gh pr view`, and blocks writes and Unix sockets. The worker's pstack extension registers it when `PSTACK_READONLY=1`, which the host sets for readonly workspaces. This is the enforcement spec 12.1 requires for `how`, `why`, and reviewer workers. The proof host in `parity/pi-native-tmux-2026-11-11/proof/host.mjs` is the reference implementation. It passed 11 lifecycle gates on real processes.

## Capability boundary (spec 9.6, 14.2, 15)

`assignment.json` gains `capabilities`:

```ts
capabilities: {
  mcp: 'inherit' | 'none',          // 'none' launches pi with --no-mcp
  env: 'inherit' | 'minimal',       // 'minimal': only PATH, HOME, LANG, TERM, TMPDIR, PI_CODING_AGENT_DIR, PSTACK_* and the provider credential variables the resolved model needs
  externalWrite: false | true,      // true only for the parent or a trusted adapter; workers default false
  spawn?: boolean                   // default false. true registers pstack_worker in that worker, for Orchestrate's sub-coordinators
}
```

Default: `{ mcp: 'inherit', env: 'inherit', externalWrite: false }` for engineering roles, and `{ mcp: 'none', env: 'minimal', externalWrite: false }` for automation-dispatched workers. A worker is automation-dispatched when its `run.json` has `parentSessionFile: null`. An explicit `capabilities` object must name `mcp`, `env`, and `externalWrite`; `spawn` is optional. `pstack_worker` spawn refuses `externalWrite: true`. A worker with `capabilities.spawn: true` also gets `pstack_worker`. Its runs live under its own workspace's `.pi/pstack/runs/`, and their `run.json` names the worker's own session file as owner, so it receives its children's wakes. Depth is capped at three levels, matching upstream Orchestrate (root, sub-coordinator, worker): the host sets `PSTACK_DEPTH`, and a spawn at depth 2 refuses `spawn: true`.

The provider credential variables are the ones pi-ai's `findEnvKeys(provider)` reports set in the parent, plus the ambient AWS and Google variables pi-ai reads for `amazon-bedrock` and `google-vertex`. The parent passes their names, never their values, and the host copies the values from its own environment. Credentials stored by `/login` live in `auth.json` under `PI_CODING_AGENT_DIR` (default `~/.pi/agent`, found through `HOME`), and both variables survive `minimal`, so Pi still reads that file. A custom provider whose `models.json` `apiKey` is `$NAME` or `!command` gets no extra variable under `minimal`. A worker with `PSTACK_WORKER=1` gets no tool that posts to Slack, a tracker, or a forge. Only `pstack_evidence` is registered. The host enforces `mcp` and `env` at spawn. Automation credentials live in `~/.pi/agent/pstack/credentials/<connector>.json` (0600), which is never named in a brief or assignment.

The same-uid limit is stated, not hidden. A worker process running as the operator's uid can still read 0600 files that uid owns. The tool and env boundary stops a worker from posting through Pi, but it is not an OS boundary. The full guarantee of spec 15.1 requires `environment: 'container'` (the container unit). Until then, automation setup reports this limit, and the parity manifest marks the credential-isolation requirement `partial`.

## Models (spec 10.3)

`~/.pi/agent/pstack/models.json` with the spec's schema: `schemaVersion: 1`, `budget`, `roles` keyed by the 17 role labels in `pstack-models.md`. A value is a model spec string or an array of them for the panel roles (`arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers`). A model spec is `inherit-parent`, `auto`, or `<provider>/<id>[:<level>]`. `src/models.ts` exports `resolveRole(role, registry, parent)` returning resolved `{ provider, id, thinkingLevel }[]` plus `limitations: string[]` (e.g. "panel has 2 entries but 1 family").

## TODO.md (spec 11.1)

`scripts/start-run.mjs --playbook <name> --title <text> [--run-id <id>]` creates the run root, `run.json`, and `TODO.md`. `TODO.md` copies the playbook's numbered steps verbatim from `generated/skills/poteto-mode/playbooks/<name>.md`, including nested lines, as `- [ ] N. <text>`, under `## Original playbook steps`, then an empty `## Task-specific work`. Completion syntax: `- [x] N. <text> (evidence: <receipt id>)`. Skip syntax: `- [~] N. <text> (skip: <reason>)`.

## Substitution vocabulary for U03 (spec 5)

| Cursor text | Pi text |
| --- | --- |
| Task tool call, subagent, `run_in_background` | `pstack_worker` spawn with an assignment file; result via collect and the `pstack-worker` wake message |
| Task `resume` of a finished agent | a fresh worker with consolidated brief (poteto-mode's own default); live-state reuse is `steer` |
| `subagent_type: poteto-agent` / `generalPurpose` / `explore` / `shell` | assignment `role` |
| `readonly: true` | `workspace.mode: 'readonly'` |
| `environment: cloud` | assignment run inside the configured container (U09); otherwise refuse |
| TodoWrite / todolist | `TODO.md` in the run root, created by `start-run.mjs` |
| Plan mode / CreatePlan | a Markdown plan file under `.pi/pstack/plans/`, checked by `check-plan.mjs`, executed only after explicit go |
| AskQuestion | ask in the conversation (`ctx.ui.select` where the extension has a UI) |
| `/loop`, AwaitShell, background shells | `pstack_worker` with `kind: 'watch'`. A watch fires once: its exit wakes the parent. A recurring loop spawns a fresh watch after every wake until its stop predicate holds, and re-arms after a parent restart from the run's `TODO.md` or plan |
| `.cursor/rules/pstack-models.mdc` | `~/.pi/agent/pstack/models.json` |
| Cursor transcripts | Pi session files under `~/.pi/agent/sessions/` |
| Cursor Automations, webhooks | U08 event adapter |

## Runtime invariants (third design, after two rejected rounds)

- Settle coverage: after `agent_settled`, the host sends RPC `get_state`. A settle covers exactly the generations acknowledged before that `get_state` response, and only when the response shows `isStreaming: false` and `pendingMessageCount: 0`. Otherwise the settle covers nothing and the host waits for the next one. Acknowledgement bookkeeping happens synchronously in the response handler.
- tmux identity: `new-session -P -F '#{session_id} #{session_created}'` is recorded in the claim. Abort's fallback lists `#{session_id} #{session_created}`, matches both, and kills `-t <session_id>`. Otherwise it refuses.
- Launch secrets: credential values and any extra env go in `<workerDir>/claim/launch-env.json` (0600, created exclusively), which the host reads once and unlinks before spawning Pi. Never argv, never logs.
- Worktrees: the host creates `worktree/` under its claim. A pre-existing path is refused; there is no reuse.
- Wake delivery after compaction: the delivery record is the active branch from `getBranch()`, compacted entries included, so a wake summarized by compaction counts as delivered. Each branch change increments a branch version. A poll started under an older version discards its result and reruns.
