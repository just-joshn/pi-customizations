# Native durable execution design

The caller uses Pi tools for timer subscriptions, webhook routine definitions, and remote Tasks. Each persistent Pi run owns its transcript and state directory. The extension registers tools without starting services. Installation remains inert.

## Candidates and decision

Candidate A uses one user-level daemon and SQLite journal for timers, webhook queues, and remote Task leases. Candidate B extends per-run detached supervisors with independent command and receipt directories. Both retain native Pi execution and make external model and service configuration explicit.

The coordinator selected Candidate B for the implementation base. The existing package already has detached RPC supervisors, persisted Task records, and completion snapshots. Per-run ownership preserves those boundaries and avoids a new shared database across unrelated workflows. An independent gpt-5.6-sol review approved the ownership topology. It required recovery journals, explicit queue states, durable cancellation, and target-observed remote placement before runtime completion. This is a different-model review within the GPT family, not cross-family evidence.

The comparison used these criteria. Scores assess design fitness, not completed behavior.

| Criterion | A | B | Reason |
| --- | --- | --- | --- |
| Native Pi integration | 4 | 5 | B reuses the current detached Pi RPC transport. |
| Transcript ownership | 5 | 5 | Both require one writer per persistent Pi root. |
| Independent failure and state ownership | 3 | 5 | B gives unrelated runs separate supervisors and files. |
| Runtime complexity | 2 | 3 | B avoids a shared database but still composes a domain supervisor, an RPC supervisor, and a Pi child. |
| Recovery evidence | 1 | 1 | Neither initial sketch implements recovery. Crash and replay tests are required. |

Graft Candidate A's bounded queue, secret-reference-only configuration, exact revision checks, and authenticated ingress validation. Reject its shared database for this increment. Keep the schedule and event envelopes private behind domain operations.

## Data shapes

A subscription contains a stable ID, owning run ID, name, literal prompt, and either a positive fixed delay or validated cron schedule. Name deduplication returns the existing unchanged configuration. Changing a timer requires cancellation before recreation. Missed and overlapping ticks coalesce to one pending occurrence.

A routine has an immutable draft revision, trigger definition, prompt, allowed input fields, secret reference, and disabled or approved activation state. Editing invalidates approval. The receiver creates a bounded original-shape webhook event after authentication. The worker never receives the sender key.

A remote Task placement contains executor identity, actual machine identity, absolute workspace, exact Git revision, effective model, isolation policy, and durable native Pi session identity. Different required VM lanes must have different actual machine identities. A local worktree is not a remote placement.

## Transcript ownership

An active TUI and a detached supervisor cannot independently write the same transcript. A local timer therefore creates a named dedicated persistent Pi root and returns that identity. The root may use the caller's branch as historical context. Its prompt identifies the branch as history rather than new instructions.

A supervisor-owned remote root can receive native timer events directly. Reconnect reads receipts rather than starting duplicate execution. An ambiguous interrupted external side effect needs reconciliation with the external system. No exactly-once side-effect claim follows from atomic file writes.

## Secrets and dormant automations

A terminal helper obtains webhook credentials through hidden TTY input and writes a private server configuration. Chat, command arguments, browser assets, model output, and wake envelopes never contain that value. A missing controlling terminal produces an initializer command, not a request to paste a secret in chat.

Benny remains absent from public skill discovery. Native setup creates reviewed disabled definitions sequentially, verifies committed operational paths and project-scoped dependencies, and preserves the source's explicit activation gate. Worker environments and agent homes contain only their required capabilities. Slack-write credentials stay with the coordinator.

## Verification sequence

1. Prove fixed schedule, name deduplication, dynamic cancellation/rearm, cron boundaries, and stop behavior with literal results.
2. Prove a native Pi tick after the initiating process exits.
3. Prove crash recovery at each durable delivery boundary before claiming recovery support.
4. Prove authenticated webhook acceptance, secret exclusion, duplicate delivery, and bounded queue behavior.
5. Prove a real remote Task with pinned revision, machine identity, reconnect, steering, resume, and stop.
6. Prove VM and credential isolation by attempted reads from the actual worker.
7. Prove dormant Benny review and execution gates using fixture integrations. External Slack and tracker execution requires configured services and explicit activation.

## Current grounding

The baseline is HEAD `48a085f5be038c514e1f86a8c29e2aa6b302972c`. Read-only investigators independently audited reference sections 0 to 2, 3 to 5, and 6 to 8. The reference is `/Users/josh-desktop/Documents/DOCS/pstack-reverse-engineering.md`.

On this machine, `orb create --isolated` supplies an Ubuntu LXC machine without host-home mounts. A dedicated `pi-pstack-parity` machine was created for filesystem-isolation verification. `systemd-detect-virt --container` returns `lxc`, while its VM probe returns `none`. It does not prove the independent-VM lane requirement. The existing `re-provider CLI` machine remains untouched. A genuine VM or configured remote host is still required for that gate.

A subsequent Lima Apple Virtualization VM has no configured host mounts. Guest probes identify `apple` virtualization and no container layer. Native Pi guest RPC selected a fixture model, completed a turn at the requested Git SHA, wrote a durable snapshot, rejected concurrent ownership, and closed explicitly. See native-parity-remote-evidence.json. This proves the helper on a genuine local VM; Task integration and configured external services remain separate verification gates.
