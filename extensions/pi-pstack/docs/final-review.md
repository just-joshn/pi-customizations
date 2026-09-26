# Final independent correctness review

Reviewed `src/workers.ts`, `src/index.ts`, `src/models.ts`, resource generation, README, compatibility report, architecture, prior review, and decision trail. This reviewer is a separate agent in the same model family as the implementation agent. This is not a cross-family review. The reviewer authored the SDK integration tests earlier, so those tests are supporting evidence rather than independent verification. No paid model requests or external service actions were performed.

## Blocking lifecycle finding

**P1. A completed worker can retain running descendants, and TaskStop does not terminate them.** In the reviewed `src/workers.ts`, the worker completion block awaits only `child.prompt()` and `child.waitForIdle()`, then marks the task settled and publishes a terminal result. Neither call waits for the child extension's background Task records. The completion block leaves the child session open. A grandchild still running can later send `pstack-task-completion` with `triggerTurn: true` into that supposedly settled child, creating a new model turn outside its parent's tracked completion promise and usage accounting.

The same path breaks cancellation. `TaskStop` calls `worker.stop()` and awaits the already fulfilled completion promise, without calling `close()`. `stop()` only calls `child.abort()`. The installed official `AgentSession.abort()` stops the current agent operation and waits for idle; it does not emit `session_shutdown`. Descendant cleanup lives in the child pstack extension's `session_shutdown` handler. Therefore TaskStop on a settled worker with a running grandchild returns a settled summary while the grandchild can continue writing. This is a concrete supported path because writable workers load this extension and can create nested background Tasks.

**Required correction.** Define when a worker is terminal relative to its owned descendants. Before publishing terminal state, drain the descendants or explicitly cancel and close them. Emit the child shutdown lifecycle and dispose the session once it becomes terminal; resume should reopen its durable transcript. TaskStop must await recursive shutdown even when the tracked foreground prompt already settled. Add a real SDK test where a child starts a delayed background grandchild, returns, and is stopped; prove that the grandchild cannot perform its later side effect or reactivate the disposed owner. Do not merely update the status string.

## Documentation and audit findings

**P2. The decision trail does not record implementation choices, fixes, or verification.** `docs/decisions.tsv` contains only framing and design rows, ending in `Implementation underway`. The work now includes generated skill-path adaptation, lifecycle changes, the native `/skill:` ordering correction, deterministic SDK tests, and explicit rejected parity claims. Upstream show-me-your-work requires contemporaneous outcomes and evidence. Add concrete rows for these decisions and final results, including accepted review findings and any unresolved limitations. The two existing rows do not support a completed auditable run.

**P2. The stated transformation list is stale.** README says the generator normalizes two names and maps the model rule location, then preserves every other byte. `scripts/resources.mjs` additionally rewrites user and project skill paths from Cursor to Pi. Architecture similarly says only names and model rule change. Those documents must include skill directory translation. The immutable upstream claim remains valid; this issue is the generated-tree description.

## Checked contracts without another confirmed blocker

- Branch restoration reconstructs mode/todos from the active branch and resets prior state. Task restoration also clears prior live workers and marks persisted running tasks interrupted. The integration tests cover session reopen, explicit off, and returning to a branch before mode activation.
- Native `/skill:poteto-mode` and setup inputs now intercept the raw command before Pi expansion, with ownership checks for discovered skill collisions. This addresses the previously reported ordering defect.
- Model resolution requires exact available identity or an unambiguous bare ID. Missing or ambiguous names error with choices. No silent model-family fallback exists. Inherited thinking can be lowered when switching to a model that does not support the parent's level; setup displays supported budget mappings, while explicit unsupported effort errors.
- Readonly workers remove mutating built-ins and extension discovery. Documentation accurately says this is not an operating-system sandbox. Benny credential isolation remains explicitly unmet. No claim of security isolation is supported by these SDK sessions.
- Complete source preservation and full behavior parity are separated clearly in README, runtime status, and compatibility report. They explicitly state 100% behavior parity is not achieved. The resource checker compares all pinned source hashes, generated bytes, extra files, and transformation records. This supports source completeness, not hosted capability equivalence.
- The source helper scripts retain their own dependencies. Cloud requests fail explicitly; local processes are never silently described as remote workers. Cursor loop/goal, Automations editor, bot routines, external team-kit skills and integrations remain unmet requirements.

## Review disposition

Resolve the descendant lifecycle finding before declaring the local task runtime complete. Update the audit trail and generated-source description. The unavoidable hosted-service gaps must remain visible as unmet user requirements even after these corrections. This review reports the inspected snapshot; subsequent fixes require their own evidence.

## Resolution review

Re-read the updated worker lifecycle, nested regression scenario, README, architecture, and expanded decision trail after the implementation fixes. Independently reran `node --import tsx --test test/workers.test.ts` against the installed official SDK. All four tests passed, including actual nested child sessions driven by a deterministic provider. No live provider calls were made.

**Lifecycle P1 resolved in the reviewed implementation.** Terminal completion now awaits `close(child)` before publishing its record or result. `close()` memoizes the shutdown promise, so concurrent closes await the same cleanup rather than treating in-progress cleanup as complete. It emits `session_shutdown`, whose descendant manager aborts and awaits each child recursively, then disposes the owner. `TaskStop` also awaits close. The regression starts a delayed grandchild, lets its owner finish, and proves the grandchild was aborted and cannot append its delayed completion or wake another owner turn. A second scenario stops the owner while that grandchild runs and proves the same absence of later writes. Same-transcript resume and provider-error tests continue to pass. The implemented terminal policy cancels outstanding descendants; workflows must await required delegated work before returning their final answer.

**Transformation-documentation P2 resolved.** README and architecture now name both model-rule and user/project skill-directory translations, alongside legal skill names. The immutable-source and partial-runtime-parity statements remain clear.

**Decision-trail P2 substantially resolved.** The trail now records asset generation, implementation, native-input/path corrections, helper verification, lifecycle review, packaging, CLI verification, and verification-offer correction with evidence pointers. Its lifecycle row still says the fix/test is in progress at this review snapshot. Append the final passing nested-test result and final verification summary so that the durable trail reflects the completed correction; this is a documentation closeout item, not an unresolved runtime blocker.

No additional implementation blocker was established by this focused re-review. Unavailable Cursor hosted services, loop/goal behavior, external team-kit capabilities, model entitlements, and Benny credential isolation remain unmet parity requirements. Same-family review and deterministic-provider evidence do not establish cross-family behavior or 100% plugin parity.

## Implementer closeout

The decision trail now includes the final nested-cancellation result, headless setup correction, full verification summary, and explicit unmet-parity verdict. The worker prompt and README now tell workers to collect required child results before their final return. The worker suite and TypeScript check passed again after that clarification. This paragraph records implementer follow-through, not an additional independent review.
