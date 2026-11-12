# One host, one socket, one native session

## Problem

Preserve pstack workflows while proving one independent native Pi worker under tmux. This candidate changes no registered tool or existing runner. The current `startChild` closes stdin after settling, and `watchParent` shuts down orphaned children. Reusing either lifecycle defeats independent ownership. The proof needs a terminal host that survives controller loss, owns Pi's pipes, and never equates quiescence with engineering success.

## Usage (caller's view)

Proposed commands, not installed commands:

```sh
worker-proof start /absolute/proof/assignment.json
worker-proof inspect /absolute/proof/assignment.json
worker-proof send /absolute/proof/assignment.json prompt '@@say READY'
worker-proof send /absolute/proof/assignment.json steer '@@say STEERED'
worker-proof send /absolute/proof/assignment.json cancel
worker-proof attach /absolute/proof/assignment.json
worker-proof send /absolute/proof/assignment.json shutdown
```

`start` creates one package-prefixed tmux session and returns its exact name. `inspect` returns the live host's identity, phase, physical model, Pi session file, and bounded diagnostic tail. A fresh controller invokes the same command against the same assignment. Inspection never starts a host or Pi process.

The attached terminal shows assignment ID, host instance, model, native session, phase, last response, and diagnostic tail. Its documented line interface accepts `prompt <text>`, `steer <text>`, `follow-up <text>`, `cancel`, `status`, and `shutdown`. Detaching does nothing to the worker. Terminal EOF disables terminal input rather than shutting down Pi. The terminal and socket feed the same host command handler.

Three programmatic call sites derive the proposed interface:

```ts
const worker = await startWorker(assignmentFile);
const current = await inspectWorker(worker.assignmentFile);
const receipt = await controlWorker(worker.assignmentFile, { kind: 'prompt', text: '@@say READY' });
```

```ts
// A different process, with no inherited handles.
const current = await inspectWorker(assignmentFile);
await controlWorker(assignmentFile, { kind: 'steer', text: '@@say STEERED' });
```

```ts
await controlWorker(assignmentFile, { kind: 'cancel' });
await controlWorker(assignmentFile, { kind: 'shutdown' });
```

A receipt reports acceptance or rejection, never task success. A disconnected mutating request has an unknown outcome and is not automatically replayed.

## Shape

Use an assignment-scoped Unix-domain socket owned by the terminal host. The controller opens a short-lived connection per command. The host owns Pi, serializes mutations until their RPC acknowledgement, continuously drains stdout, and handles events while commands are pending. Read-only inspection and shutdown deadlines must not wait behind an indefinitely active prompt. Prompt acknowledgement is not run completion.

The immutable assignment records exact executable and arguments, authorized cwd, session directory, model, fixture resources, environment allowlist, and limits. The host rejects an assignment whose canonical digest differs from the first claimed digest. One exclusive claim directory is created before any Pi spawn. It is never automatically removed or reclaimed, even after host death. A duplicate start therefore cannot create a replacement writer. A new experimental run uses a new assignment ID and fresh session directory. Reboot survival and host restart are outside this unit.

Native Pi exclusively writes its transcript. The host exclusively writes its append-only lifecycle journal and atomically replaced snapshot. The claim and immutable assignment are authoritative for identity. The journal is authoritative for historical host observations, not liveness. Only a matching live socket handshake plus a fresh Pi state response establishes a live observation. An absent host returns `unavailable` even if the snapshot says `running`. This choice follows Separate Before Serializing Shared State. Controllers never write host state.

Model the Domain changes the result shape. `accepted`, `running`, `idle`, `aborted`, `failed`, and `unavailable` are explicit outcomes. There is no success verdict field. A transport acknowledgement stays separate from host observations. `agent_settled` permits `idle` only after inspecting terminal assistant errors and abort information. Unexpected child exit, including exit zero, produces `failed`. A deliberate orderly shutdown ends as `unavailable` with a shutdown reason and exit receipt.

Prefer the exported Pi `RpcClient` where it fits. It does not fit this host. The actual 1.5.2 declaration has no public stdin-close, dialog-response, or exit subscription. Its implementation accumulates stderr without a bound and stops with direct-child signals. The 1.5.0 declaration is byte-identical and its inspected implementation has the same gaps. Use a small private JSONL subprocess adapter with only the proof's RPC subset, not a general replacement client. No private Pi fields or deep runtime imports.

## Synthesis decision

This is candidate B, not the cross-runner synthesis. Select the live socket actor over the filesystem mailbox alternative below. Keep immutable assignments and durable observation receipts from the mailbox shape, but do not persist a replayable command queue. Four public functions hide tmux launch, pipe handling, request correlation, dialog cancellation, and lifecycle policy. The caller supplies only an assignment path and domain command.

## Tradeoffs accepted

- We accept no host recovery in exchange for fail-closed writer ownership without stale-lock takeover or process-ID reuse races.
- We accept ambiguous command results after controller disconnect in exchange for no transactional task database or unsafe replay of tool actions.
- We accept a bounded local protocol adapter because both inspected public clients lack required host capabilities.
- We accept trusted fixture execution with isolated HOME and agent directory, not OS isolation. No real credentials enter the host environment.
- We accept native transcript growth within a short proof run. A file-size or duration limit fails and shuts down the proof rather than truncating native evidence.

## Alternatives considered

**Filesystem mailbox with host polling.** Controllers atomically publish request files under a protected inbox. The host owns Pi and writes response files. Fresh controllers recover request receipts without an open socket. This hides connection loss but exposes durable request identity and ambiguous replay policy to every caller. Host death leaves requests that cannot safely be replayed after arbitrary tool effects. A polling mailbox also needs backlog limits, cleanup rules, and per-request ownership. It is viable if explicitly non-replaying, but deeper persistence machinery earns nothing in this proof.

**Controller-owned RpcClient with tmux as display only.** This makes the controller the pipe owner and needs fewer host components. It fails the contract because controller death closes stdin and a new controller cannot adopt the public client's existing pipes. Persisting a PID does not repair this. Reject it before sketching further.

Both viable host shapes pass single-writer ownership. The socket shape has the smaller public contract and no command-storage schema. Red-flag screening found no temporal stage modules or transport types exposed to callers. Keep the lifecycle and Pi adapter in one host file to avoid pass-through layers. Do not add a daemon registry, scheduler, generic transport factory, or second launch path.

## Open questions and risks

- Can the real fixture be loaded under each selected exact Pi binary with all automatic resources disabled? The implementation must prove this before lifecycle experiments, not upgrade packages to make it work.
- Does the abort experiment keep Pi occupied until `clear_queue` completes? Use a real long-running bash tool call and inspect its native messages. A timing-only sleep followed by a missing artifact is insufficient evidence.
- Does a forced host death leave Pi finishing pending work during orderly stdin-EOF disposal? Report the process and transcript observations. Never reclaim the assignment while that uncertainty remains.

No product decision blocks this candidate. These questions are experimental gates.

## Next implementation step

Build the one-assignment host and its isolated real-Pi smoke driver, then prove reconnect and duplicate-start rejection before adding steering and cancellation cases.
