# Policies, defect decisions, and verification gates

This document specifies proposed behavior and tests. No test in this document was run by candidate 2. Evidence roots use the abbreviations in [PI-WIRING.md](PI-WIRING.md).

## File admission and confirmations

`ChatFiles` has explicit editable and read-only collections. `/add` and `/read-only` resolve user paths and update the selected category. `/drop` removes membership. `/ls` renders both lists. Membership does not prove that a file exists or is readable on the next request. Fresh reads drop unreadable editable files with the Aider diagnostic. They skip unreadable read-only content. Model-generated paths pass format resolution before edit permission.

Preserve Aider's already-editable fast path and per-batch permission memoization. Do not treat read-only prompt classification as an OS sandbox. The proposed defect fix requires explicit promotion before editing a read-only path. Both the source and destination of a move need permission. Path normalization and symlink/root policy must be decided at admission, not by each format implementation. Out-of-root access is not automatically a bug in Aider, so a new restriction must have a separate policy ledger row.

The confirmation model is:

```typescript
type QuestionKey = { readonly question: string; readonly subject: string | null };
type PermissionQuestion = {
	readonly key: QuestionKey;
	readonly defaultAnswer: 'yes' | 'no';
	readonly explicitYesRequired: boolean;
	readonly allowNever: boolean;
	readonly group: { readonly id: string; readonly showGroup: boolean } | null;
};
type PermissionAnswer =
	| { readonly kind: 'yes' }
	| { readonly kind: 'no' }
	| { readonly kind: 'all'; readonly group: string }
	| { readonly kind: 'skip'; readonly group: string }
	| { readonly kind: 'never'; readonly key: QuestionKey }
	| { readonly kind: 'cancelled' };
```

The decision order follows `A/aider/io.py:807-925`.

1. An exact `neverAsk` match answers no.
2. A hidden group behaves as no group. A visible group enables don't-ask-again.
3. Global yes answers yes only when explicit acceptance is not required. Explicit-yes-required answers no under yes-always.
4. Global no answers no.
5. A group preference answers all or skip for that group only. Explicit acceptance never inherits an all decision.
6. Otherwise request input. Yes permits one question. All permits the visible group. Skip denies the group. Don't ask denies and stores the exact question/subject key.

Use `ctx.ui.select` for the available choices in both TUI and RPC. Use `ctx.ui.input` only when Aider's text-input semantics are required. A yes/no `confirm` cannot encode group preferences. Pass the active signal in `ExtensionUIDialogOptions` to dismiss owned dialogs on abort. Cancellation is denial, not the Aider EOF-as-default behavior. Record that safety divergence as a ledger decision.

`CA/docs/rpc-extension-ui.md` fully specifies select, input, confirm, cancellation, and the RPC response matching IDs. `CA/dist/core/extensions/types.d.ts:39-46` defines dialog signal and timeout. RPC reports `hasUI: true`. TUI-only `custom()` is unnecessary here.

Print and JSON modes have no interactive confirmation. Respect explicit yes/no settings and explicit-yes-required restrictions. When no policy answers a required prompt, deny or report that interaction is required. Do not read stdin separately, and do not silently infer yes from Aider's default. An interactive Aider confirmation in these modes is an impossible host combination, not a missing dialog implementation.

## Notices and shell suggestions

Aider's `tool_output`, `tool_warning`, and `tool_error` become the existing `Notices` boundary from `P/src/edit/working-tree.ts`. The adapter maps them to `ctx.ui.notify` in TUI and RPC, with info, warning, and error levels. Important durable notices also become `custom` entries with an entry renderer. They are not model messages merely because they are visible to the user.

For print mode, diagnostics can go to stderr. JSON and RPC stdout remain reserved for Pi records. Use Pi's `entry_appended` output for durable structured notices, not an invented stdout protocol. Final assistant output remains Pi's. If the final projected message is a custom message rather than an assistant, print mode can emit no final text. Avoid adding a trailing model-visible acknowledgment merely as a display log. This source-traced edge is documented in `G/pi-runtime-semantics.md`.

Suggested shell commands require explicit acceptance. Yes-always does not approve them. Execution can use Pi's public `pi.exec` with a signal and selected shell argv. `CA/dist/core/exec.d.ts:7-14` supplies signal, timeout, and cwd, but no `env` option. Per-command environment isolation therefore needs a separately verified native-compatible mechanism before that configuration feature lands. Do not claim it automatically participates in model tool-call permission hooks. `ExtensionContext` in lifecycle events does not expose `executeTool`; only `ExtensionToolContext` does. No model-callable wrapper tool is introduced just to execute reply-text edits. The approval policy is the Aider domain boundary.

`P/src/edit/working-tree.ts` already guards dry-run mutations but only queues individual writes/removes. It does not serialize an entire parse/read/match/write transaction. The candidate must not wrap that same non-reentrant queue around calls that acquire it again without checking queue behavior. Complete read-modify-write safety is an unresolved implementation seam with the current WorkingTree port. External editors cannot be serialized by an in-process queue in any case.

## Configuration

One private option specification owns validation, default, flag name, environment suffix, and settings key. Generate help and resolution from that specification. Do not keep hand-synced flag and env lists. Every Pi-visible spelling that replaces an Aider name comes from `P/src/branding.ts`. `BRANDING.envPrefix` is already `PI_MAINTAINER_`.

Resolved precedence is explicit CLI over environment over extension settings over Aider defaults. Within settings, the intended Aider ordering is home, Git root, then cwd, with later values winning. If Pi global/project settings are chosen instead, document the absent Git-root layer rather than claiming exact Aider file precedence. The full source trace is the lint/test reconstruction at lines 96-113, which cites `configargparse` and `A/aider/main.py:305-330,466-504,590-600`.

Aider dotenv loading uses `override=True` before parsing and can replace shell environment values. A literal port would unexpectedly alter the shared Pi process environment. The candidate proposes reading extension-option dotenv values into the resolver rather than mutating `process.env`. Subprocess environment changes belong to command-specific env values. This is a ledger-visible adaptation, not a claim of identical global side effects.

Pi exposes `registerFlag` with boolean/string types, `getFlag`, and `getSettings`. It does not expose `registerSettings` or a typed extension settings namespace in the inspected API. Do not fabricate either method. A separate extension-owned config reader may be needed for Aider-specific settings. That stores configuration, not Pi session/context state. A new filename must first be added to the branding module. Explicit-config exclusivity and home/Git-root/cwd parsing require dedicated fixtures before implementation claims parity.

Leave flag defaults unset at registration where source presence affects precedence. Apply Aider defaults only after merging. Paired positive/negative controls require their own option policy because native extension flags are not argparse `BooleanOptionalAction`. Numeric settings arrive as strings and must be parsed once. Repeatable Aider flags cannot be represented by repeated Pi extension flags because `CA/dist/cli/args.js:241-255` stores unknown flags in a map. List-valued settings or a single encoded-list flag can preserve values but change CLI syntax. This remains an explicit parity gap.

The lifecycle option groups are:

| Group | Domain options |
| --- | --- |
| Format and mode | Default code format, persistent mode, one-shot mode intent, max reflections |
| Models | Main physical model, editor physical model or main fallback, editor format from main-model policy |
| Files | Editable/read-only selections, encoding, line endings, dry run |
| Permissions | Yes-always, no-always, architect auto-accept, shell suggestions |
| Later Git | Auto-commits, dirty commits, attribution and commit-message policy |
| Later context | Repo-map policy and context-mode expansion/always-refresh |
| Later checks | Auto-lint, language lint commands, auto-test, test command |

The model-specific Aider prompt settings are not automatically Pi model metadata. `examples_as_sys_msg`, `use_system_prompt`, reminder placement, and editor format need an Aider model-policy table keyed to configured physical models. That is prompt/edit policy, not a transport/provider registry. Pi retains provider parameters, auth, retries, reasoning encoding, and cost reporting.

## Proposed defect ledger rows

These rows are design decisions to add to the real parity ledger before port changes. They are not claims that fixes have landed. Each row needs an oracle case documenting the Aider baseline and a separate literal assertion for the corrected result. Existing port policy requires a `fix` row before deviation.

| Proposed row | Documented defect or concern | Corrected contract and layer |
| --- | --- | --- |
| `fix/patch-add-admission` | Permission precreates the missing path, so patch ADD then refuses it. | Admission grants creation without touching. The patch operation creates content. |
| `fix/dry-run-mutations` | DELETE, MOVE, touch, stage, dirty checkpoints, and manual Git paths escape isolated dry-run guards. | Every mutation capability, including later Git and mutating validation commands, receives one effective dry-run policy. Dry-run leaves disk and HEAD unchanged. |
| `fix/move-destination-permission` | Common authorization covers only the source. | Authorize destination and overwrite separately. No unapproved destination write. |
| `fix/empty-edit-result` | Successful empty-string replacement is treated as failure. | Use null failure versus string success, never truthiness. |
| `fix/udiff-partial-report` | Error-string length is compared with hunk count. | Track failed hunk count and report successful siblings accurately. |
| `fix/preflight-dependent-blocks` | Preflight does not simulate earlier edits and can authorize a different target from application. | Resolve a batch against an evolving planned working tree and bind permissions to final targets. Preserve format matching policy. |
| `fix/provider-partial-error` | A nonretryable provider error can leave partial content reachable by editing. | Only complete eligible Pi replies enter edit parsing. |
| `fix/actual-write-reporting` | Prepared target set is mistaken for successful writes. | Preserve prepared target selection and add a separate written-path report. |
| `fix/apply-outcome-reporting` | `--apply` can exit zero after failure. | Expose a typed failed apply outcome. Pi print exit-code control for extension-only failures needs a separate verified host contract. |
| `fix/reminder-double-count` | Current messages appear in assembled token count and are added again. | Count each chunk once. Unknown count policy remains explicit. Requires baseline and corrected token fixtures. |
| `fix/read-only-promotion` | Ordinary permission can admit a reference file without naming promotion. | Ask explicit promotion and update category membership atomically in the domain snapshot. |
| `fix/cancel-is-not-consent` | Aider EOF uses the default, which can be yes. | Pi dialog cancellation denies. Print without a configured answer never simulates acceptance. |
| `fix/dirty-checkpoint-failure` | A failed checkpoint does not stop writes. | Failed required protection returns a typed failure before application. |
| `fix/commit-failure-not-unchanged` | A false Git commit result can become a no-edits message. | Keep failed, disabled, unchanged, and committed results distinct. |
| `fix/validation-noop-status` | Unsupported/unavailable lint or no test command can appear passed. | Use not-run/unavailable/failed/passed outcomes. Preserve reflection ordering. |
| `fix/lint-diagnostic-fallback` | Unknown language after a custom command, Path-like names, stale contexts, or unusual compilation errors can break diagnostics. | Normalize paths at the boundary, retain plain diagnostics when source rendering is unavailable, and label/read the correct source revision. |
| `fix/oneshot-test-feedback` | One-shot test flow discards repair feedback and child failure status. | Later test command must return and handle typed feedback/failure, rather than infer it from editor placeholder state. |
| `fix/repomap-duplicate-captures` | Capture loop appends final nodes again. | Later map port retains each intended capture once with an oracle divergence fixture. |
| `fix/package-resources` | Installed Aider distribution omits runtime subpackages/resources. | Test the distributed Pi package in isolation, not only the source checkout. |
| `fix/config-global-env` | Literal dotenv mutation changes unrelated Pi extension environment. | Resolve maintainer values locally and pass explicit subprocess env. Record this host adaptation. |

The editing reconstruction's Gotchas table at lines 589-614 supplies most editing rows. Git reconstruction lines 604-652 and lint/test reconstruction lines 334-351 supply lifecycle-adjacent failures. The rows are not a complete future Git/map/lint defect census. Examples still needing their feature's decision include Git attribution flag semantics, index version sanity, pretty/nonpretty diff parity, undo wording and remote-safety claims, unsupported-language documentation, and map-cache staleness. They remain required work, not exclusions from the user's requirement to fix documented defects.

Ambiguous cross-file first match, all-occurrence udiff replacement, partial writes, and whole-file Git commits are baseline behavior, not automatically defects. Do not silently turn them into unique-match rejection, transactions, or region-only commits.

## Verification plan

The first implementation artifact should be a persisted-session scripted-provider test of architect/editor handoff. It must prove the critical public API combination before any large controller port.

### Pure domain and format tests

- Replay the Aider oracle over each format's reply text and WorkingTree fixtures. Keep intended behavioral equivalence separate from ledger-authorized fixes.
- Assert exact ordered ChatChunks against literals, including fresh file text, examples, all acknowledgment punctuation, empty selections, images, tail reminders, and mode/model policy.
- Assert initial response plus exactly N reflections. Test N equal to zero and context mode's `maxReflections - 1` cutoff.
- Assert the complete response-order trace. An accepted lint repair must prevent suggested-shell execution and tests in that response. Automatic commit must precede lint.
- Test independent parent/editor file sets, separate reflection budgets, editor history clearing, no editor map or shell suggestions, and commit-hash return.
- Test yes, no, all, skip, don't ask again, hidden groups, explicit-yes-required, global yes/no, cancellation, and a new permission batch.
- Test duplicate reply receipts, missing receipt completion, malformed/unknown schema, dropped paths, partial writes, and no automatic replay after a crash.

### Real Pi print and RPC tests

Use installed Pi 1.1.0 with a scripted provider registered through the native extension API. All files and session JSONL live in temporary test directories. This is verification infrastructure, not a replacement product host.

1. Route architect response to physical model A and editor response to B in one `session.prompt` lifetime. Capture each actual provider request. Assert both model identity and distinct full prompts.
2. Confirm `before_agent_start` fires once across the boundary continuation. Assert the editor prompt still changes and the parent prompt policy returns on the next user input.
3. Assert the editor receives only its permitted history, fresh file snapshots, the architect answer as user input, no repository map, and zero model-declared tools.
4. Make the editor emit a bad edit, then a successful reflection. Assert separate editor counts, actual file bytes, and no accidental architect regeneration.
5. Use disk persistence, not `--no-session`. Restart, reload, fork, navigate away and back, and inspect both active-branch domain records and provider requests. Do not treat a raw JSONL append alone as proof of reconstructed behavior.
6. Force compaction before editor entry and within editor reflection. Reject the implementation if it reintroduces compacted raw parent history or leaks editor conversation into the parent's reconstructed done history. This is a blocking feasibility test, not an optional regression.
7. Register another boundary handler before ours that proposes entries and continuation. Register one after ours that inspects them. Assert every foreign entry survives and continuation is never cleared merely because maintainer is done.
8. Add prior context transforms, duplicate-content messages, and foreign custom messages. Prove which cooperation contract is supported. Never claim arbitrary provenance preservation from a simple isolated case.
9. Abort during an approval, between file writes, after the receipt, and before the next request. No aborted/errored reply applies edits. A remaining intent produces an interrupted state on restart.
10. Exercise Pi's queued steering and follow-up ordering during architect completion. Assert the controller does not double-count a retry as a reflection or replay an editor input after another user exchange supersedes it.
11. In RPC, answer select dialogs through native extension UI responses and wait for `agent_settled`, not `agent_end`. In JSON/print, assert no stdin prompt and no stdout diagnostic contamination.
12. Assert false/absent auth is a configuration failure and a virtual editor target is rejected. Test fresh model-catalog lookup rather than a stale `Model` object captured before reload.

The existing prototype is useful evidence for test setup, not a substitute for these tests. No runtime feasibility result beyond that prototype is asserted by this candidate.
