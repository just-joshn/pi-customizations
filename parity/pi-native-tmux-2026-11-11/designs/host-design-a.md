# First native worker proof

## Problem

A disposable controller must reconnect to the same live Pi RPC worker without becoming its parent or transcript writer. The current runner ends stdin on settlement, while its parent watchdog and registry tie workers to the parent. This proof leaves those paths unchanged. It proves lifecycle behavior, not engineering-task success or isolation.

## Usage (caller's view)

A proof operator creates a private run directory containing `assignment.json`, an isolated HOME and Pi agent directory, the scripted-model extension, and an empty session directory. The assignment specifies an absolute executable and argv, cwd, model, and explicit resource profile. A launcher starts a uniquely named tmux session running `host --assignment <path>`. The launcher waits for a successful endpoint handshake, then can exit. An operator attaches with `tmux attach-session -t <exact-name>` and types `steer <text>` into the host's line interface. This is host input, not Pi TUI automation.

```ts
const worker = connectWorker(assignmentPath);
await worker.prompt('@@sleep 3000 first');
const before = await worker.inspect(); // actual selected model and native session path
```

```ts
// A different process, after the original controller exits.
const worker = connectWorker(assignmentPath);
await worker.steer('respond with the revised instruction');
const after = await worker.inspect(); // same host instance and native session
```

```ts
await worker.followUp('@@script ...');
await worker.clearQueue();
await worker.abort();
await worker.shutdown(); // only this host and its own Pi child
```

Each call connects to the host's private Unix socket. `connectWorker` constructs a handle; each operation performs a fresh bounded request and verifies the assignment identity. A transport timeout is an unknown result, not permission to retry a prompt. The controller reads the native session file and output artifact directly for evidence. Acknowledgements are not evidence that work ran.

## Shape

The assignment is immutable after exclusive creation and is the durable authority for intended identity and launch. The live host is the authority for current lifecycle and the socket; Pi owns its transcript. A state snapshot may aid diagnosis but is never used as a liveness oracle. The host holds the sole Pi stdin/stdout connection and accepts short controller connections. Terminal input and socket requests enter the same command dispatcher. The host displays bounded recent output, model, session path, and state.

Before spawning Pi, the host takes an OS advisory exclusive lock on a stable per-assignment lock file and holds its descriptor for its lifetime. All proof hosts must use that same canonical private directory and lock primitive. The lock is never unlinked or replaced while a host may exist. The winner checks for an existing endpoint and removes only a stale socket inside that directory after holding the lock. A losing host exits before spawning Pi. If the host dies, the lock releases and the socket becomes unavailable. Do not automatically launch a replacement or reuse its transcript. A host death can leave a child or descendants alive, so recovery requires explicit inspection and cleanup, not automatic restart. This single-writer choice follows separate-before-serializing-shared-state.

The host launches the exact argv without a shell under a whitelist environment with isolated HOME and PI_CODING_AGENT_DIR. Resource profile records the actual explicit local limits and their enforcement method, not an isolation promise. Validate canonical cwd, directory ownership and permissions, identifier syntax, argv and allowed paths before spawn. Use a private 0700 directory and 0600 socket. Restrict control and RPC line sizes, connection count, command timeouts, stderr ring buffer and displayed output. Parse and validate JSONL at both boundaries, consume stdout continuously, honor stdin backpressure, correlate requests by ID, and reject malformed input. These choices follow boundary-discipline.

Pi 1.5.2 recommends its public `RpcClient`, but the installed public declaration and implementation do not expose dialog responses, an exit notification/code, bounded stderr, or stdin closure. It accumulates stderr and exposes no public raw send. A small host-local JSONL adapter is therefore necessary for the stated contract, not a private-field workaround. Cancel `select`, `confirm`, `input`, and `editor` requests with the matching ID; show notifications without responding. Close stdin for orderly shutdown, wait for exit, then use bounded signal escalation against the owned child only. Track child exit directly, including zero exit, as unavailable or failed unless shutdown was requested. Never convert exit to success.

Lifecycle is independent of transport. `accepted` means a request was acknowledged, `running` follows activity, and `idle` follows Pi quiescence. `aborted` requires observed cancellation, not merely the abort acknowledgement. A provider error or unexpected child exit is `failed`; an unreachable host is `unavailable`. None says the task passed. Register event handling before prompting. Handle prompt disposition `handled` without waiting for a settlement. Serialize destructive control operations in the host. For cancellation clear the queue first and await its response before aborting. Verify absent queued writes in artifacts and transcript, not by acknowledgement alone.

## Type and module sketch

```ts
// worker.ts: the only controller-facing module.
type WorkerId = string & { readonly workerId: unique symbol };
type AssignmentPath = string & { readonly assignmentPath: unique symbol };
type Assignment = Readonly<{
  id: WorkerId; cwd: string; sessionDir: string;
  launch: Readonly<{ executable: string; args: readonly string[] }>;
  model: Readonly<{ provider: string; id: string }>;
  resources: Readonly<{ home: string; agentDir: string; limits: readonly string[] }>;
}>;
type State = 'accepted' | 'running' | 'idle' | 'aborted' | 'failed' | 'unavailable';
type Inspection = Readonly<{
  id: WorkerId; hostInstance: string; state: State;
  model: Readonly<{ provider: string; id: string }> | null;
  sessionPath: string | null; diagnostics: string;
}>;
interface Worker {
  inspect(): Promise<Inspection>;
  prompt(text: string): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  clearQueue(): Promise<void>;
  abort(): Promise<void>;
  shutdown(): Promise<void>;
}
declare function connectWorker(path: AssignmentPath): Worker;

// host.ts: validates assignment, owns lock, socket, child, screen, and lifecycle.
declare function runHost(path: AssignmentPath): Promise<void>;

// rpc.ts: private adapter, no Pi wire types exported by worker.ts.
interface PiConnection {
  request(command: 'prompt' | 'steer' | 'follow_up', text: string): Promise<void>;
  clearQueue(): Promise<void>;
  abort(): Promise<void>;
  inspect(): Promise<{ provider: string; model: string; sessionPath: string | null }>;
  close(): Promise<void>;
}
declare function spawnPi(assignment: Assignment, onEvent: (event: unknown) => void): Promise<PiConnection>;
```

The private adapter also handles typed internal exit and event callbacks, validated before updating state. `unknown` above marks the external boundary, not a promise to pass unvalidated wire events into lifecycle logic. The concrete implementation must use a discriminated internal event union. A synchronous `connectWorker` does not claim liveness. `inspect` obtains actual Pi state through the host and fails or returns unavailable on connection failure. All other methods report transport or command errors without guessing whether a timed-out operation ran.

## Synthesis decision

Select the socket-owning tmux host. The host concentrates lifecycle and RPC details behind one domain handle. It needs one persistent process and one private endpoint. Its authoritative live state cannot outlive the process, so failure is explicit. This is one candidate's local comparison, not a claim that an independent arena or implementation verified it.

## Alternatives considered

1. A controller owns Pi stdio and a separate tmux viewer tails output. This has a small interface but disconnect kills or strands the writer. Reconnection requires FD transfer or process adoption, which exposes lifecycle details and fails the disposable-controller constraint. Reject.
2. A tmux host owns Pi while controllers append command files and poll result files. This removes sockets but introduces request naming, atomic publication, duplicate delivery, replay and cleanup rules. Durable files hide connectivity but expose uncertain command completion and multi-writer coordination. Reject for this single-machine proof. A file mailbox would need an explicit at-most-once protocol, not blind replay.

Both candidates avoid a task database. The selected host uses a lock only for the true single-writer invariant, not to serialize independent worker state. Red-flag screening found that splitting terminal and socket command handlers would create two paths and split ownership; both instead dispatch through the same host function. The transport and lifecycle state remain private rather than becoming caller imports.

## Tradeoffs accepted

- We accept no automatic host-crash recovery in exchange for never silently creating a second writer.
- We accept a small maintained RPC adapter in exchange for bounded diagnostics, dialog cancellation, and observable exits.
- We accept local trusted-fixture operation in exchange for no claim of sandboxing or production credential isolation.
- We accept uncertain outcomes on control timeout in exchange for no unsafe automatic retry.

## Open questions and risks

- Which concrete OS advisory lock dependency is already available in the target package? Its semantics and descriptor lifetime must be demonstrated before implementation; a stale PID file alone is insufficient.
- Can the fixture and installed Pi execute with a genuinely scrubbed environment and the chosen resource limits on the target host? Capture exact argv, environment key names, and limits without secrets.
- Can the test reliably establish that an abort event represents cancellation rather than a concurrent natural settlement? If not, report inconclusive.
- How will host-crash cleanup identify descendants without PID reuse? This proof must not claim safe automatic recovery until that is proven.

## Next implementation step

Build the private host and socket around the real installed Pi and scripted model, then run the contract's ten experiments against real processes before considering runtime integration.

## Evidence plan and source grounding

Record tmux session name and host/Pi PIDs, assignment digest, exact launch argv, selected model and session path, transcript excerpts, output file contents, screen capture, control responses, process exit status, and cleanup receipt in the private proof directory. Verify a fresh controller sees the same instance and session after the first exits. Verify steering in the transcript. Queue a distinctive file write, clear it, abort active work, and check the file was never written. Kill Pi and inspect host state. Race two hosts for the same assignment and count Pi children. Send invalid IDs, oversized and malformed records. Shut down the exact owned session only. Mark each experiment VERIFIED, NOT VERIFIED, or INCONCLUSIVE, and never infer a passing task verdict.

Sources read locally: `parity/pi-native-tmux-2026-11-11/worker-proof-contract.md`, `workflow.md`, `extensions/pi-pstack/docs/native-gaps.md`, `extensions/pi-pstack/test/fixtures/scripted-model.ts`, `extensions/pi-pstack/src/task/runner.ts`, `extensions/pi-pstack/src/index.ts`, and installed Pi 1.5.2 `docs/rpc.md`, `docs/rpc-extension-ui.md`, and `dist/modes/rpc/rpc-client.d.ts` plus implementation. The 1.5.0 gaps are grounded in the repository's audit, not a fresh 1.5.0 runtime test. No experiment has been run by this design task.
