# Lifecycle arena synthesis

Status: candidate 2 was selected in `../ARCHITECTURE.md` and the decision trail at 2026-10-10T04:31:08Z. The scoring below is the retained pre-selection analysis. Implementation verification remains pending.

## Dropouts

None. Both seats produced complete packages.

## Parent scores

Scores use `grounding/ARENA-RUBRIC.md`. The parent read every file in both packages end to end.

| Criterion | Candidate 1, reducer | Candidate 2, exchange controller |
| --- | --- | --- |
| Parity fidelity | 4 | 4 |
| Pi-native correctness | 4 | 5 |
| Interface depth | 4 | 4 |
| Extension points | 4 | 5 |
| Testability and failure semantics | 5 | 4 |

**Parity fidelity.** Both packages order the post-response pipeline like `base_coder.py:1419-1623` and treat the architect hook's `None` return correctly, so the parent pipeline resumes after `reply_completed`. Candidate 1 replaces Aider's two file sets with one `ChatFiles` map. That forbids the editable and read-only overlap that `allowed_to_edit` can create, so it is a behavior change that needs a fix row before it can be the baseline. Candidate 2 keeps Aider's two sets and leaves promotion to a fix row.

**Pi-native correctness.** Both route the editor through one virtual model, change prompts through `context_with_system`, compose `event.entries`, and close lifecycles at `agent_settled`. Candidate 2 also names two limits that candidate 1 glosses over. Context hooks receive messages without source entry IDs, and `pi.exec` has no `env` option. It also blocks unexpected tool calls with `terminate: true`.

**Interface depth.** Candidate 1 has the purest core. `restore`, `decide`, and `assemble` take values and return values. The cost is an effect language. Every dialog, write, commit, lint run, and shell command becomes an effect plus an observation round trip, so the shell runs an interpreter loop and the reducer carries many waiting states. Candidate 2 has one installer export and a controller with four methods. Its `completeReply` is a straight async sequence with early returns that mirrors `send_message` line for line, which makes source-to-port review direct.

**Extension points.** Candidate 2 names `GitPolicy`, `RepositoryContext`, `Validation`, and `PermissionPolicy` with result types that separate committed, unchanged, disabled, and failed outcomes. Those distinctions are the shapes several documented defect fixes need. Candidate 1 fixes the same slots as effect kinds without typed outcomes.

**Testability and failure semantics.** Candidate 1 records intent and observation around each destructive effect, keyed by response entry and action ordinal. Reconciliation can then name the exact ambiguous step. Its pure reducer tests need no fakes. Candidate 2 records receipts around the whole reply, which is coarser, but its real-Pi verification plan is broader, including foreign handlers, queued steering, and RPC dialogs.

## Selected base and grafts

Candidate 2 is the base. A maintainer extending this port compares it against Aider's source, and a controller that reads like `send_message` keeps that comparison cheap. Candidate 1's effect interpreter adds a layer that Aider does not have.

The following grafts are binding implementation and verification obligations:

- The response transition table as the behavioral test contract.
- Per-destructive-step intent and observation receipts instead of one receipt per reply.
- A named pure `restore(branch)` fold for reconstruction on `session_start` and `session_tree`.
- The explicit `agent_before_settle` role as final reconciliation without a second response processor.
- The evidence that `message_end` precedes persistence, so user-entry binding happens in the route callback.

Rejected from candidate 1:

- The generic effect interpreter, for the reason above.
- The single `ChatFiles` map as the baseline, because it changes Aider behavior without a fix row.
