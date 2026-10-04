# Durable host native gaps

This audit targets Pi 1.0.2. Durable Task, subscription, and routine contracts require an external owner after the initiating Pi process exits. Native RPC already supports a long-lived Pi root. Root longevity is not a missing Pi capability.

The gaps concern detached ownership, reconnection, scheduling, authenticated ingress, and whole-process isolation. Pi remains authoritative for sessions, branches, model requests, tools, queues, retries, compaction, cancellation, and usage.

## Public mechanisms checked

The audit inspected the public `RpcClientOptions`, `RpcClient`, `ExecOptions`, `BashOperations`, and `SessionManager` declarations. It also inspected the official RPC command and extension-UI references, security guidance, and checked `rpc-extension-ui.ts` example.

`RpcClient` starts `node <cliPath>`. Its public interface has no arbitrary launcher, attachable transport, detach operation, or extension-UI response method. Its `send` method is private. Raw RPC has a documented UI-response record, which the official example writes to the child's stdin.

Neither the public RPC command reference nor the SDK exposes durable schedules, cron subscriptions, CI observations, or authenticated webhook ingress. `pi.exec` cannot detach a process and does not accept hook stdin or an environment override. Project trust and tool restrictions are not operating-system isolation.

## Required adapters

Each row records the required behavior, why omission violates the maintained contract, the native mechanism evaluated, the remaining gap, the smallest adapter, Pi's authority, verification, and the deletion condition.

| Adapter | Required behavior and omission cost | Native mechanism and remaining gap | Smallest adapter and Pi authority | Verification | Delete when |
| --- | --- | --- | --- | --- | --- |
| `scripts/detached-rpc-client.mjs`, `detached-rpc-server.mjs`, `detached-rpc-protocol.mjs`, and `rpc-process.mjs` | Detached tasks and automation roots survive the initiating process and accept later control. Dropping detached ownership breaks the documented Task and automation contracts. | RPC owns long-lived execution and events. `RpcClient` cannot detach, reconnect to a living child, select an arbitrary launcher, or answer extension UI requests. | One surviving pipe owner forwards ID-correlated native RPC records. Private files carry host commands and receipts. Pi owns the child session and execution. | `test/detached-rpc.test.ts`, `test/rpc-process.test.ts`, `test/permission-relay.test.ts`. | A public Pi host supports detachable ownership, reconnection, the required launcher, and UI responses. Migrate individual pieces as each gap closes. |
| `scripts/timer-*.mjs` and `src/timers.ts` | Fixed-delay, cron, and CI subscriptions retain identity and recover exclusively. Ambiguous external effects require explicit reconciliation. Omitting these behaviors breaks the subscription tools' durability promises. | Native RPC executes prompts and resumes saved sessions. It has no durable schedule or occurrence journal. | The external scheduler owns time, CI observations, deduplication, and occurrence receipts. It delivers native prompts and observes native settlement. Pi owns every agent run. | `test/timer-service.test.ts`, `test/timer-recovery.test.ts`, `test/timer-bootstrap-recovery.test.ts`, `test/timer-tool-journey.test.ts`, and CI fixture tests. | Pi exposes equivalent durable subscriptions, occurrence receipts, and exclusive recovery. |
| `scripts/routine-*.mjs` and `src/routines.ts` | An approved immutable revision receives authenticated, bounded webhook events without exposing the sender key to the model. Accepted events survive owner failure. Omitting these controls breaks the routine's security and durability contract. | Native UI confirms the revision and native RPC runs prompts. Pi has no authenticated webhook receiver, hidden sender-key initializer, or durable ingress journal. | A receiver validates requests and stores bounded event records. A relay submits native prompts. Pi owns execution and transcripts. The operator approves the exact revision through native UI. | `test/routine-service.test.ts`, `test/routine-relay.test.ts`, `test/routine-secret.test.ts`, `test/routine-isolation.test.ts`. | Public Pi mechanisms provide the corresponding ingress, secret, and durability controls. |
| `scripts/filesystem-launch.mjs` | The child cannot read coordinator secrets or mutate supervisor stores. Omitting isolation violates the documented routine and worker credential boundary. | Pi security guidance requires a real OS or VM boundary. Project trust and readonly tools do not provide one. | A fail-closed whole-process launcher applies the supported macOS sandbox policy. Pi still owns permission dialogs and tool execution inside the child. | `test/routine-isolation.test.ts` and `test/cloud-filesystem.test.ts`. | An equivalent supported whole-process isolation launcher replaces this adapter. |
| Remote worker launch and transport | VM placement, the checkout SHA, model identity, resume, and single-writer ownership must describe the actual remote process. Omitting placement verification could misrepresent local execution as remote isolation. | RPC controls a process through owned pipes. It does not provision VMs or reconnect to a remote detached host. | The configured executor launches Pi and returns a verified placement receipt. Native RPC controls the guest. Pi owns its session, model work, and accounting. | `test/remote-worker.test.ts`, `test/remote-worker-transport.test.ts`, and executor fixtures. Actual VM verification requires a configured executor. | Public Pi hosting provides equivalent remote placement and durable ownership. |

## Settlement and recovery

Live activity derives from native `agent_start` and `agent_settled` events. A handled prompt or rejected prompt also closes the host invocation without claiming that a model turn succeeded.

Timer recovery accepts a matching durable invocation receipt. It does not infer final settlement from a stopped assistant message or raw transcript entries. `get_entries` includes abandoned branches, and an assistant stop can precede automatic continuation.

If the native settlement receipt is lost, an attempted occurrence becomes `needs_reconciliation`. The subscription stays disabled until the operator checks the transcript and external effects, then explicitly subscribes again. Recovery does not replay ambiguous side effects.

`test/timer-recovery.test.ts` covers a stopped assistant on the active branch, a stopped assistant on an abandoned branch, and a positive matching native settlement receipt. The two message-based regressions fail before deletion of the transcript predicate.

## Host observation limits

Polling command and receipt files observes the external host's transport. Process checks prevent a second writer and detect orphaned supervisors. Neither observation declares an agent run settled or successful.

PID checks and command-line matching are imperfect identity evidence. The host fails closed when it cannot establish exclusive ownership. These checks do not replace Pi lifecycle events.

Project trust must come from the initiating context's explicit decision. Approving a Task placement or routine revision does not approve project-local code. Child resource discovery and launch must preserve declined trust.

## Verification limits

Loopback tests prove local protocol and ownership behavior. They do not establish production provider acceptance or exercise a separately configured VM. No new custom model loop, tool proxy, session authority, or completion inference is introduced by this migration.
