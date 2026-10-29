# Native gaps

Every custom adapter in pi-maintainer, with eight answers recorded before custom logic is added. The answers are, in order: the exact required behavior, the Pi mechanism evaluated, why the public API cannot express the requirement, why omitting the behavior is unacceptable, the smallest adapter, the Pi-owned state that stays authoritative, the verification, and the condition for deleting the adapter.

All citations refer to installed Pi 1.4.0 under `CA` = `@earendil-works/pi-coding-agent/` and to the Aider checkout at `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`.

## Settings

### Option files and environment variables

1. **Behavior.** Aider resolves each option from the command line, then `AIDER_<NAME>`, then `.aider.conf.yml` in the home directory, the Git root, and the working directory (later files win), then an explicit `--config` file above those, then the argparse default (`aider/main.py:464-501`, configargparse `parse_known_args`). pi-maintainer applies the same order with `PI_MAINTAINER_<NAME>` and `.pi-maintainer.conf.yml`.
2. **Mechanism evaluated.** `pi.registerFlag` and `pi.getFlag` for the command line; `pi.getSettings()` for settings.
3. **Why it cannot.** `pi.getSettings()` returns Pi's own merged settings (`CA/dist/core/extensions/types.d.ts:1286`). There is no extension settings namespace, no `registerSettings`, no environment-variable binding, and no Git-root settings layer.
4. **Why not omit.** Aider users configure edit format, dry run, encoding, files, and every later SAR's options through these files and variables. Without them, a configured Aider setup has no equivalent.
5. **Adapter.** `src/settings/`: `config-files.ts` finds the files and parses YAML with PyYAML's scalar typing (`yaml-values.ts`), `sources.ts` converts each source the way configargparse's `convert_item_to_command_line_arg` does, and `resolve.ts` picks the highest-precedence valid value per option.
6. **Authoritative Pi state.** Pi's CLI parsing and flag registry. The adapter reads flags only through `pi.getFlag`, and never reads `process.argv`.
7. **Verification.** `test/settings/settings.oracle.test.ts` runs 52 resolution cases through Aider's own `get_parser` and configargparse with real home, Git-root, and working-directory files, and 12 YAML typing cases through configargparse's `YAMLConfigFileParser`. Reversing the file precedence fails 5 of them.
8. **Delete when.** Pi offers extension-owned settings with environment and project-root layers, or the operator drops Aider's configuration surface.

### `.env` files

1. **Behavior.** Aider loads `.env` from `~/.aider/oauth-keys.env` (first), the home directory, the Git root, the working directory, and `--env-file` (default `<git root>/.env`), later files overriding earlier ones and duplicates keeping their last place, with python-dotenv's grammar and `${VAR}` interpolation (`aider/main.py:305-388`). The values feed the second option parse. pi-maintainer uses `~/.pi-maintainer/oauth-keys.env` for the oauth slot.
2. **Mechanism evaluated.** None in Pi. Pi reads provider credentials itself and offers no dotenv loading to extensions.
3. **Why it cannot.** No Pi API loads `.env` files for an extension.
4. **Why not omit.** `PI_MAINTAINER_*` variables in a project `.env` are a documented way to configure Aider, and the operator decision in `docs/ARCHITECTURE.md` requires them.
5. **Adapter.** `src/settings/dotenv.ts` ports python-dotenv's parser and `resolve_variables`. `load.ts` applies the files to a copy of the environment, then applies `--set-env` / `--api-key` overlays through `environment-pairs.ts` without writing `process.env`.
6. **Authoritative Pi state.** Pi's `process.env`. The adapter never writes it, because Aider's `load_dotenv(override=True)` would replace provider credentials that Pi owns. This is a deliberate adaptation: `.env` values reach option resolution and the environment of commands pi-maintainer runs, not Pi.
7. **Verification.** 22 python-dotenv cases and 5 `generate_search_path_list` cases in `test/settings/settings.oracle.test.ts`; `test/settings/load.test.ts` and `test/settings/settings-bind.test.ts` prove `process.env` is untouched and overlay order.
8. **Delete when.** Pi loads project `.env` files for extensions.

### Flag spellings Pi cannot express

`pi.registerFlag` accepts `boolean` or `string` flags. `CA/dist/cli/args.js:241-255` stores every unknown long flag in a `Map`, so one name keeps one value and distinct names lose their relative order. Each Aider option kind below needs a small adapter in `src/settings/sources.ts`, and each adapter is verified in `test/settings/load.test.ts`.

| Aider kind | Example | What Pi does | Adapter |
| --- | --- | --- | --- |
| `BooleanOptionalAction` | `--dry-run`, `--no-dry-run` | Two unrelated boolean flags | Both names are registered. When both are given, Pi cannot report which came last, so the problem is reported and `--no-` wins. |
| `action="append"` | `--file a --file b` | Last value wins | A flag value in configargparse's list syntax, `--file '[a.py, b.py]'`, becomes a list. A plain value is one item. |
| Aliases of one action | `--edit-format`, `--chat-mode` | Two unrelated string flags | Both are registered and map to one option. When both are given, the conflict is reported and the alias wins. |
| `store_const` into another option | `--architect` | A boolean flag | Registered as a boolean that writes `architect` into `edit-format`. A conflict with `--edit-format` is reported. |
| `type=int`, `type=float`, `choices` | `--line-endings crlf` | A string | Parsed once with Python's `int`/`float` rules and checked against the choices. An invalid value is reported and skipped; Aider exits with status 2. |
| Short options | `-c CONFIG` | Rejected as an unknown short option | None. Only the long form `--config` exists. |
| Positional files | `aider a.py b.py` | Positional arguments are prompt messages | None. Use `--file`. |

Two Pi parsing behaviors have no adapter. A boolean extension flag followed by a word takes the word as its value (`args.js:248-251`), so `pi --dry-run "fix it"` loses the prompt; write the prompt first or after `--`. Flag values exist only after extensions load (`CA/dist/core/agent-session-services.js:8-46`), so resolution runs on `session_start`, not in the factory.

These rows are deleted when Pi's extension flags gain negation, repetition, and ordering.

The flag adapters share the following gate answers. The table above identifies the exact syntax for each kind.

1. **Behavior.** Preserve all Aider option values and validate numeric and choice inputs.
2. **Mechanism evaluated.** `registerFlag` and `getFlag`, plus installed `dist/cli/args.js`.
3. **Why it cannot.** Pi exposes only string and boolean values, without repetition, alias identity, or argument ordering.
4. **Why not omit.** The original E6 brief requires every edit option to use the shared resolver.
5. **Adapter.** Register explicit spellings and decode one value from Pi. Encoded lists replace repeatable flags. Conflicting spellings produce diagnostics.
6. **Authoritative Pi state.** Pi parses argv and stores flag values. There is no private argv parser.
7. **Verification.** Settings oracle tests cover conversion and precedence. SDK tests resolve startup file lists from YAML. These adapters do not schedule work or alter branches, permissions, or usage.
8. **Delete when.** Native extension flags express these kinds and retain their order.

## Reply-text editing and operation receipts

1. **Behavior.** A finalized assistant reply becomes parsed edits, preflight, file permission preparation, application, and at most three repair responses. Each destructive operation has intent and observation records keyed by committed reply entry ID and ordinal.
2. **Mechanism evaluated.** `turn_end`, `agent_before_settle`, `appendEntry`, boundary drafts, and `withFileMutationQueue`.
3. **Why it cannot.** Pi owns those boundaries but does not interpret Aider reply formats. Pi's session append and filesystem write are not a shared transaction.
4. **Why not omit.** Reply-text editing and crash-safe refusal to replay ambiguous edits are binding E6 requirements.
5. **Adapter.** `ExchangeController.completeReply` calls format and permission methods directly. `journaledTree` wraps write, touch, and remove with individual receipts. Final reconciliation never parses a reply again.
6. **Authoritative Pi state.** SessionManager owns reply IDs, transcript, active branch, continuation, retries, compaction, and usage. The controller stores domain facts only.
7. **Verification.** Real SDK tests inspect requests, disk bytes, receipts, and final settlement. Error and aborted provider replies are excluded before parsing. Pi-owned retries preserve the reflection count and do not apply failed response text. The later-write failure case retains the first successful disk write and both operation outcomes. Multi-file edits are non-atomic. A missing observation blocks replay.
8. **Delete when.** Pi offers native reply-text formats and a durable operation journal, or the edit protocol changes to Pi tools.

## File transaction callback

1. **Behavior.** Serialize the complete preflight, read, permission preparation, and write transaction for every potentially mutated file.
2. **Mechanism evaluated.** Native `withFileMutationQueue`.
3. **Why it cannot.** It supplies one non-reentrant file lock. Queued WorkingTree write adapters cannot reacquire that lock inside the transaction.
4. **Why not omit.** The operator requires complete read-modify-write serialization rather than write-only locks.
5. **Adapter.** `WorkingTree.mutate` resolves effective file identities, deduplicates aliases, acquires sorted native locks, and supplies an unqueued tree during the callback. Resolution follows symlinks before collapsing `..`. Standalone mutations use the same identity. Formats declare all mutation endpoints. The registry also locks editable fallback candidates.
6. **Authoritative Pi state.** Native file queues remain the only serializer. Pi session state and provider lifecycle are unchanged.
7. **Verification.** File transaction tests use actual files and competing native queue operations. The callback checks cancellation, rejects reentry and undeclared mutations, and releases locks on failure. Python oracle cases and an actual SDK write verify symlink parent traversal. A symlink-loop test protects the lexical parent from unintended writes. External editors, retargeted symlinks, and processes are outside this in-process guarantee.
8. **Delete when.** Pi exposes a multi-file mutation scope with lock-aware file adapters.

## Branch-derived domain state

1. **Behavior.** Editable and read-only sets, mode, reflection counts, permissions, and receipts follow the active session branch through reload and navigation.
2. **Mechanism evaluated.** `appendEntry`, `getBranch`, `session_start`, and `session_tree`.
3. **Why it cannot.** Pi stores custom entries but does not know the Aider domain schema or fold.
4. **Why not omit.** Branch-aware chat files and interruption recovery are binding requirements.
5. **Adapter.** `restore(branch)` validates versioned domain entries and folds snapshots and receipts without I/O. Hook handlers rebuild disposable controllers from that value.
6. **Authoritative Pi state.** SessionManager selects the branch and persists entries. Navigation does not undo disk edits. No external journal or transcript mirror exists.
7. **Verification.** SDK tests use persistent session reopen, reload, and `navigateTree`. Pure restore tests check unknown schemas, duplicate identities, orphan observations, and pending receipts. Pending receipts block startup creation. A branch predating maintainer metadata refuses requests until the operator selects a physical model and reloads. Commands refuse changes while a run is active.
8. **Delete when.** Pi offers a native branch-relative extension state schema and reducer. Domain permission and format semantics still belong to maintainer.

## Full-transcript prompt assembly

1. **Behavior.** Each actual request uses Aider's system, examples, read-only files, repository, done history, fresh chat files, current history, and reminder order.
2. **Mechanism evaluated (Pi 1.4.0).** Structured `before_agent_start`, `context`, `context_with_system`, `context_edit` drafts (`CA/docs/extensions.md:230`), and `buildSessionProjection`.
3. **Why it cannot.** Pi has no mid-run structured prompt setter. Conversation-only transforms cannot place system reminders. Context messages lack source-entry IDs. `context_edit` can omit or replace existing transcript entries but cannot insert the read-only and editable file pairs Aider places before the current message.
4. **Why not omit.** File content and fences must refresh before each reflection, with Aider chunk placement.
5. **Adapter.** `projectRequest` calls a supplied `PromptSource`, folds incoming system state, replaces the owned preamble, and retains incoming transformed messages. Position-preserving transforms support done/current partitioning. Other shapes retain incoming history without claiming exact partitioning.
6. **Authoritative Pi state.** Canonical context and compaction stay in SessionManager. Earlier transformations are not replaced with raw branch messages. Foreign prompt sections, free-form system text, and tool state survive folding. Tools are disabled through the native active set.
7. **Verification.** Real provider requests show file context and reflection feedback. The order test compares with pinned Aider `format_chat_chunks` output. Prior transformations, branch reload, and compaction cases check the supported cooperation contract. PromptSource receives the active native abort signal. Missing or failed formatting calls `ctx.abort()` and sends no provider request. Synthetic acknowledgments have zero usage and are request-local. Native accounting tests verify that they add no usage or cost. Exact token counting and canonical prompt-transition recording remain unsupported.
8. **Delete when.** Pi supplies provenance-preserving full-context transforms and a mid-run structured prompt setter.

## Confirmation adaptation

1. **Behavior.** Preserve Aider yes, no, all, skip, never, default, and explicit-yes-required decision rules, with denial on Pi dialog cancellation or unavailable UI.
2. **Mechanism evaluated.** Native `ctx.ui.select`, `confirm`, and dialog abort signals.
3. **Why it cannot.** Pi confirm cannot express group answers. Print and JSON have no stdin confirmation interface.
4. **Why not omit.** Files outside the editable set require admission before application.
5. **Adapter.** `createHost` maps offered choices to native select and passes the active signal. No UI returns no unless an explicit global policy has already answered. Cancellation never becomes Aider's EOF-as-default acceptance.
6. **Authoritative Pi state.** Pi owns dialog lifetime and cancellation. Branch snapshots store never answers. Aider's batch preference remains local to each batch.
7. **Verification.** Confirmation oracle tests cover source decision rules. Real SDK permission tests cover configured yes, denial without UI, and interruption. No model usage is added for confirmations.
8. **Delete when.** Pi provides a native confirmation policy with the same groups and noninteractive behavior.

## Command environment

1. **Behavior.** Maintainer subprocesses receive the locally resolved `.env` environment without changing provider credentials in `process.env`, and without placing secret values on the child process argv or in logged command lines.
2. **Mechanism evaluated.** `pi.exec` with cwd, timeout, and signal.
3. **Why it cannot.** Pi 1.4.0 `ExecOptions` is `{ signal, timeout, cwd }` only (`CA/dist/core/exec.d.ts:7-14`) and has no environment field. Passing `NAME=value` through `env -i` puts those values on argv, which process listings and command logs can expose.
4. **Why not omit.** The architecture requires local dotenv values to reach maintainer commands, and credential material must not appear in argv.
5. **Adapter.** `src/core/isolated-exec.ts` spawns the command with Node's `env` option, the resolved maintainer environment plus a per-command overlay, and the same cwd, timeout, and abort behavior as `pi.exec`. `Host.exec` merges the overlay over that environment, so `/git`, attribution commits, lint, and shell suggestions all inherit `.env` values. It never constructs shell text and never puts assignments on argv.
6. **Authoritative Pi state.** Pi still owns session lifecycle, auth, and provider transport. This adapter only runs maintainer Host subprocesses. `process.env` is never written.
7. **Verification.** `test/core/host.pi.test.ts` checks literal environment output and abort propagation. `test/core/core-review.pi.test.ts` proves a synthetic marker reaches the child environment and does not appear in `process.argv`. No Git, map, lint, shell-suggestion, or Windows command parity is claimed by E6.
8. **Delete when.** `pi.exec` accepts an explicit command environment that stays off argv.

## Scripted provider test adapter

1. **Behavior.** Deterministically record actual in-process provider requests and supply text, malformed, error, aborted, and tool-call responses.
2. **Mechanism evaluated.** SDK `createAgentSession`, `DefaultResourceLoader`, and public `pi.registerProvider`.
3. **Why it cannot.** A remote real model cannot deterministically produce every malformed or cancellation case. No supported external wire API represents this test script.
4. **Why not omit.** The original brief requires actual SDK lifecycle execution rather than mocked hook invocation.
5. **Adapter.** `test/support/pi-session.ts` registers one test-only scripted streaming API. It uses public resource loading and does not wrap an agent loop.
6. **Authoritative Pi state.** AgentSession and SessionManager own requests, persistence, branches, model selection, tools, and settlement.
7. **Verification.** Integration assertions inspect received normalized requests, literal disk contents, persisted branch facts, and `agent_settled`. The stream honors abort and request instrumentation. It adds no network service or background process.
8. **Delete when.** Pi provides a public deterministic scripted-provider test fixture with these scenarios.

## Architect editor prompt-cache headers

1. **Behavior.** Aider sets `cache_prompts=False` and `num_cache_warming_pings=0` on the editor coder (`aider/coders/architect_coder.py:30-31`).
2. **Mechanism evaluated (Pi 1.4.0, re-checked against `~/.pi/agent/install/releases/1.4.0` and the matching `@earendil-works/pi-coding-agent@1.4.0` / `pi-ai@1.4.0` install).** `cache_warming_decision` for idle warming; `ModelRoute` (`model`, `thinkingLevel`, optional `state` only; `dist/core/virtual-models.d.ts`); `StreamOptions.cacheRetention` on pi-ai (`none` | `short` | `long`); `before_provider_request` / `before_provider_headers` (payload replace / in-place header mutate); SettingsManager (`cacheWarming` only, no `cacheRetention`); `AgentSession` has no `cacheRetention` API; `ProviderChatModelConfig.promptCache` is per-model TTL tiers for warming, not a request-local off switch.
3. **Why it cannot.** Architect→editor is an in-run virtual-route continuation. `ModelRoute` cannot attach `cacheRetention: "none"`. Settings and `AgentSession` expose no mid-run cacheRetention control. Compaction hardcodes `cacheRetention: "none"` for its own summarize calls only. `before_provider_request` can rewrite an already-built body, but that is a per-API strip of `cache_control` / `prompt_cache_*` fields rather than Pi building a cache-off request on the editor continuation. Idle warming stop is expressible; per-request prompt-cache header byte identity is not.
4. **Why not omit.** Ledger row `edit.architect.editor-options` includes disabling prompt caching and cache warming. File context, shell-off, warming stop, and no format-change summarizer are expressible; prompt-cache header off is not.
5. **Adapter.** `cache_warming_decision` returns `{ action: 'stop' }` while `snapshot.phase.kind === 'editor'` via `cacheWarmingDecisionForPhase`. No provider cache headers are invented or stripped.
6. **Authoritative Pi state.** Pi owns warming timers and provider cache policy. Compaction owns summarization; the editor frame adds no format-change summarizer.
7. **Verification.** `test/core/modes.pi.test.ts` proves editor file context, `suggestShellCommands: false`, mid-editor warming stop, and zero `session_before_compact` / compaction entries on the architect→editor path. Residual for verified status: per-request prompt-cache header byte identity remains unsupported. Row stays open.
8. **Delete when.** Pi offers a request-local `cacheRetention` (or equivalent) on virtual-route continuations that editor frames can set, or the ledger sentence drops the prompt-caching claim.

## Pre-send context-limit proceed confirm

1. **Behavior.** When estimated request tokens reach the model input limit, Aider reports the overflow, lists ways to reduce context (`/drop`, `/clear`, smaller files), and sends the request only if the user confirms `Try to proceed anyway?` (`aider/coders/base_coder.py:1396-1417,1429-1432`).
2. **Mechanism evaluated (Pi 1.4.0, re-checked).** `estimateTokens` / `shouldCompact` / `ctx.compact()` / `session_before_compact`; compaction on `threshold` and `overflow` with automatic compact-and-retry; `ctx.getContextUsage()`; `ctx.ui.confirm` / Host `confirm`; `ctx.abort()` from `before_agent_start` / `context_with_system`; `before_provider_request` (result type `unknown`, payload replace only).
3. **Why it cannot.** Pi owns context-window management as compaction and overflow recovery (Pi's `docs/compaction.md`). Threshold compaction and post-error overflow recovery run without a pre-send admission confirm. `before_provider_request` can replace a payload but cannot express confirm-gated send. `ctx.ui.confirm` and `estimateTokens` exist, but composing them into Aider's `check_tokens` gate would invent a second overflow policy beside Pi compaction.
4. **Why not omit.** Ledger row `edit.prompt.context-limit-confirm` requires that proceed-anyway confirm. Omitting leaves the row open.
5. **Adapter.** None. No custom pre-send token gate is added.
6. **Authoritative Pi state.** Compaction settings, threshold triggers, overflow recovery, and provider send stay with AgentSession.
7. **Verification.** Row stays open. Re-check recorded in `docs/decisions.tsv` for this residual. No claimed FAIL for this id beyond the open status.
8. **Delete when.** Pi exposes a public pre-send context-limit admission hook that can report overflow tips and confirm before the provider call, or the ledger sentence drops the proceed-anyway confirm.

## File watcher host attachment

1. **Behavior.** Aider watches workspace roots with `watchfiles`, filters to AI-comment files, interrupts waiting input on changes, and builds AI! / AI? requests with `grep_ast.TreeContext` structural slices (`aider/watch.py`).
2. **Mechanism evaluated (Pi 1.4.0, re-checked).** Package exports are `.` and `./rpc-entry` only. `ExtensionAPI` events include `session_start` / `session_shutdown` (long-lived resources), `input` (transform or handle submitted user text; not idle-prompt wake), `ui_prompt_start` / `ui_prompt_end` (blocking extension UI, not the main editor wait), and `sendUserMessage`. `ExtensionUIContext` exposes `getEditorText` / `setEditorText` / `pasteToEditor` but no interrupt of idle prompt input. Internal `dist/utils/fs-watch.d.ts` (`watchWithErrorHandler`) is not re-exported from `dist/index.d.ts` or `dist/core/index.d.ts`. No `TreeContext`, `tree-sitter`, `interrupt_input`, or public workspace file-watch API appears in installed `.d.ts` files.
3. **Why it cannot.** Live `watchfiles` semantics, idle-prompt interrupt, and TreeContext structural slices are not public Pi mechanisms. Deep-importing `dist/utils/fs-watch.js` would use a private path. Wiring `process_changes` with the Aider line-comment fallback (no tree) would not satisfy the ledger's structural-context claim, and inventing a TreeContext harness is forbidden until parser recovery accepts a production bridge (`docs/verification/tree-sitter-recovery-2026-10-10.md`).
4. **Why not omit.** Ledger rows `edit.watch.comments`, `edit.watch.filter`, `edit.watch.roots`, `edit.watch.changes`, and `edit.watch.lifecycle` are required edit parity. Omitting the domain port leaves AI-comment watching unportable. Row `edit.watch.requests` remains required and stays open.
5. **Adapter.** `src/core/watch.ts` ports ignore loading, AI-comment extraction, filter, roots, change accumulation, and start/stop lifecycle behind an injectable `WatchMonitor`. No live `fs.watch` / `watchfiles` loop is started from the extension factory or `session_start` in this bind. No request builder or chat-file admission for AI! / AI? is attached. `edit.watch.requests` stays open until a verified parser supplies structural context and Pi exposes watch plus idle-input interrupt (or the ledger drops those claims).
6. **Authoritative Pi state.** Session lifecycle, prompt queue, and model context stay with Pi. The watcher only holds pending changed paths and monitor handles.
7. **Verification.** `test/core/watch-bind.test.ts` ports Aider `test_watch` units and proves filter and lifecycle contracts for the five verified watch rows. `edit.watch.requests` has empty `pi` / `src` / `tests` and remains open after this re-check. No newly expressible subset closed without a TreeContext or host-watch API.
8. **Delete when.** Pi exposes a public workspace file-watch API with cancellation, plus a documented way to interrupt idle prompt input; delete the monitor adapter when those land. Delete the requests gap when a Pi-native or approved parser provides TreeContext-equivalent slices and the request path can be verified against them.

## Lint and test local shell (pexpect / shell=True)

1. **Behavior.** Shell, lint, and test commands run with the user's privileges, through pexpect when interactive on a non-Windows terminal and otherwise through a subprocess with `shell=True` (`aider/run_cmd.py:11-23,42-86`).
2. **Mechanism evaluated (Pi 1.4.0).** `Host.exec` / `pi.exec` via `isolatedExec` with argv arrays and `shell: false`. No public PTY or shell-string exec API on Host.
3. **Why it cannot.** Interactive pexpect (`spawn` + `interact`) and Python `subprocess` `shell=True` are not public Pi mechanisms. Inventing a parallel shell runner beside Host.exec would reintroduce injection risk Aider accepted for free-form command strings.
4. **Why not omit.** Ledger row `lint.run.local-shell` requires that runner. Omitting leaves the row open.
5. **Adapter.** `src/lint/shell.ts` runs command strings as `/bin/sh -c` through Host.exec. Lint language commands append an `oslex`-style quoted relative path. No pexpect path is started. That adapter is trusted shell under the user account (`lint.security.shell-trust`): filename `shellQuote` does not sandbox compound commands, redirections, or `;` chaining.
6. **Authoritative Pi state.** Session lifecycle, permissions, and provider transport stay with Pi. Working-tree bytes stay with `WorkingTree`.
7. **Verification.** Row `lint.run.local-shell` stays open (pexpect / interactive `shell=True` not claimed), including Aider's `test_linter/TestLinter.test_run_cmd_win`, which Aider skips on every non-Windows host; pi-maintainer has no Windows `pexpect` path to verify. `lint.security.shell-trust` is verified via `test/lint/security-bind.test.ts` against the `/bin/sh -c` adapter. Follow-up and options rows that only need Host.exec argv execution are verified separately.
8. **Delete when.** Pi exposes a documented interactive PTY exec and/or a safe shell-string exec that extensions may use for lint, test, and suggested shell commands, or the ledger drops the pexpect/`shell=True` claim.

## Python lint tree-sitter syntax checks

1. **Behavior.** Python lint combines tree-sitter syntax errors, compile errors, and flake8 errors limited to E9,F821,F823,F831,F406,F407,F701,F702,F704,F706, reported under "# Fix any errors below, if possible." with tree context around the error lines (`aider/linter.py:80-166`). Tree-sitter syntax fallback alone records zero-based ERROR/missing start rows without columns (`aider/linter.py:80-166`). Model-facing lint reports render tree context around extracted lines (`aider/linter.py:80-166,272-285`).
2. **Mechanism evaluated.** Same tree-sitter recovery constraint as map structural context (`docs/verification/tree-sitter-recovery-2026-10-10.md`). Host.exec can run flake8 argv and a compile probe. Line extraction and plain diagnostic text already bind without TreeContext.
3. **Why it cannot.** Built-in `basic_lint` / `TreeContext` slices require an accepted production tree-sitter bridge. Deep-importing private parsers or inventing a TreeContext harness is forbidden until recovery accepts one.
4. **Why not omit.** Ledger rows `lint.python.checks`, `lint.tree-sitter.syntax-errors`, and `lint.diagnostics.context-render` require tree-sitter syntax and TreeContext slices. Omitting leaves those rows open.
5. **Adapter.** None for tree-sitter syntax or TreeContext rendering. Configured `--lint-cmd` values run through Host.exec. Default Python combine path is not claimed. Plain diagnostic headers and extracted source lines remain on the Host.exec custom-cmd path.
6. **Authoritative Pi state.** Unchanged.
7. **Verification.** Rows `lint.python.checks`, `lint.tree-sitter.syntax-errors`, and `lint.diagnostics.context-render` stay open after this re-check, including the `ev-lint/probe/javascript-syntax` replay, whose JavaScript ERROR-node detection needs the same parser. Expressible lint dispatch/diagnostics/line-extraction rows are verified separately.
8. **Delete when.** Parser recovery accepts a production bridge that can supply TreeContext-equivalent slices for lint, or the ledger drops the tree-sitter syntax and context-render claims.

## Callable test commands

1. **Behavior.** Aider accepts a callable test command that is invoked directly, prints and returns truthy errors, and does not change cwd or insert chat messages (`aider/commands.py:993-1011`).
2. **Mechanism evaluated.** `pi.registerFlag` string `--test-cmd`, `Host.exec` for string commands, `Validation.runTestCommand` for `/test` and auto-test.
3. **Why it cannot.** Pi settings and flags expose string values only. There is no extension API to register or invoke an in-process callable as a test command without inventing a parallel callable registry outside Aider's config surface.
4. **Why not omit.** Ledger row `lint.test.callable-no-chat` requires that callable path. Omitting leaves the row open.
5. **Adapter.** None for callables. String `--test-cmd` / `/test` argv runs through Host.exec. Callable test commands are not claimed.
6. **Authoritative Pi state.** Session chat and Host.exec stay with Pi.
7. **Verification.** Row `lint.test.callable-no-chat` stays open. String `/test` and auto-test rows are verified separately.
8. **Delete when.** Pi exposes an extension-owned callable or script-hook settings kind for test commands, or the ledger drops the callable claim.

## Repository map structural rendering

1. **Behavior.** Aider renders each mapped file by building a `TreeContext` for its definition lines with parent context, no child context, no line numbers, no last line, and no margin, then emits filename-only entries for files without tags and truncates every rendered line to 100 characters (`aider/repomap.py:710-784`).
2. **Mechanism evaluated.** Pi 1.4.0 public API: package exports are `.` and `./rpc-entry` only; `ExtensionAPI` exposes no parser, AST, or structural-slice mechanism, and `pi.exec` runs an external process rather than returning node data. `src/map/query-runtime.ts` is the injection point where a production query runtime would land.
3. **Why it cannot.** `render_tree` needs tree-sitter node types, byte ranges, and parent chains. Pi exposes no parser and no TreeContext equivalent, and the parser recovery review (`docs/verification/tree-sitter-recovery-2026-10-10.md`) does not accept a production bridge for one. Deep-importing a private parser path or bundling a native grammar beside Pi would be a parallel analysis engine, not a Pi mechanism.
4. **Why not omit.** Ledger row `map.render.structural-context` requires parent context around definition lines. Filename-only rendering is the part that stays expressible without a parser.
5. **Adapter.** None for structural context. `src/map/render.ts` emits Aider's filename-only entries and applies the same 100-character line cap to filename lists and to supplied excerpts (`renderFilenameMap`, `renderRankedMap`, `formatMapExcerpt`, `truncateMapLines`). Tag capture goes through an injected `QueryRuntime` that production leaves unavailable.
6. **Authoritative Pi state.** Unchanged. The map holds no session, transcript, or provider state; Pi owns context assembly and model routing.
7. **Verification.** `test/map/scaffold-bind.test.ts` proves filename-only rank order and the 100-character cap, and `test/map/files-hints-bind.test.ts` proves rendered filename exclusion. Row `map.render.structural-context` stays open with empty `pi` / `src` / `tests` and `gap: "native"`; the Python symbol assertions of `test_repomap/TestRepoMap.test_get_repo_map_with_identifiers` stay with that open row. Every expressible render row is verified separately.
8. **Delete when.** Pi exposes a public parser or AST bridge (or the parser recovery review accepts one) that can supply TreeContext-equivalent slices, or the ledger drops the structural-context claim.

## Console output without a UI

1. **Behavior.** Aider writes its console messages with `io.tool_output` and `io.tool_error`, including `Committing <path> before applying edits.` (`aider/coders/base_coder.py:2188`), `Applied edit to <path>` (`:2334`), `Commit <hash> <message>` (`aider/repo.py:306`), and the usage report (`aider/coders/base_coder.py:2102-2109`).
2. **Mechanism evaluated (Pi 1.4.0).** `ctx.ui.notify` for interactive and RPC clients (`docs/extensions.md:365`, `docs/rpc-extension-ui.md:97-111`), `pi.appendEntry` (`entry_appended` in JSON and RPC, `docs/json.md:122`), and stderr, which the JSON reference reserves for diagnostics and application logging (`docs/json.md:21`).
3. **Why it cannot.** Print and JSON modes have no UI, so `ctx.ui.notify` is discarded there. JSON and RPC reserve stdout for their protocol records, so extension text cannot join Aider's stdout stream, and Pi exposes no extension console-write API.
4. **Why not omit.** Aider's applied-edit, checkpoint, and commit lines are its primary feedback channel. Without them a non-interactive run reports nothing about what it changed.
5. **Adapter.** The runtime notice handler calls `ctx.ui.notify` when `ctx.hasUI`, writes the same line to stderr otherwise, and always appends a `notice` entry for the transcript. RPC clients receive the notification through the extension UI protocol; print and JSON runs read stderr.
6. **Authoritative Pi state.** Pi owns UI delivery, stdout framing, and the session transcript.
7. **Verification.** `test/core/notice-channel.pi.test.ts` proves the settings-loader detail and the commit announcement reach stderr with no UI. The edit journeys assert `Commit <hash> <subject>` on print stderr and a `notify` record in RPC.
8. **Delete when.** Pi exposes an extension console API for print and JSON that keeps their stdout framing intact, or Aider's messages become Pi notifications in those modes.

## Done-history summarization

1. **Behavior.** Aider summarizes `done_messages` once they exceed `max_chat_history_tokens`, whose default is `min(max(input_tokens / 16, 1024), 8192)`. It uses the weak model then the main model with `prompts.summarize`, and replaces the summarized span with one user message, `summary_prefix + summary` (`aider/coders/base_coder.py:510-517,1002-1044`, `aider/history.py:27-123`, `aider/prompts.py:50-68`).
2. **Mechanism evaluated (Pi 1.4.0).** `ctx.compact()` (manual compaction entry point), `session_before_compact` (custom summary and `firstKeptEntryId`), `estimateTokens`, and `ctx.modelRegistry.complete`.
3. **Why it cannot match exactly.** Pi selects the cut with its own `keepRecentTokens` and refuses when no cut point exists (`Nothing to compact (session too small)`), so Aider's soft budget cannot force a summary of a history Pi considers small. Pi keeps a recent tail instead of Aider's half-budget tail, wraps the summary in its compaction message, and compacts after the run settles rather than in Aider's worker thread.
4. **Why not omit.** Parity requires the budget option, Aider's summarize prompt, the weak-model-first ladder, and a summary that reaches the next request. Row `edit.history.summary-budget` is verified; row `edit.history.recent-tail-split` stays open for Aider's half-budget tail and recursion.
5. **Adapter.** `--max-chat-history-tokens` is registered. After an edit-applying settle, the runtime estimates the projected history and calls `ctx.compact()` once the Aider budget is exceeded, and `session_before_compact` answers that compaction with Aider's summarize prompt and the weak-then-main ladder while keeping Pi's cut and message wrapper. Pi's own threshold and overflow compactions keep Pi's structured summary.
6. **Authoritative Pi state.** Pi owns compaction entries, cut points, and context rebuilds. The maintainer stores no parallel history.
7. **Verification.** `test/core/history-summary.pi.test.ts` proves the budget formula, the trigger predicate, the `# USER` / `# ASSISTANT` request text, a compaction entry whose summary is `summary_prefix + model reply`, and the weak-model call through the scripted provider. Row `edit.history.recent-tail-split` has empty `pi` / `src` / `tests` and `gap: "native"`.
8. **Delete when.** Pi exposes a per-history soft-budget compaction trigger with an Aider-compatible kept span, or the ledger drops the done-history claim.

## One-shot exit status

1. **Behavior.** `aider --test` without `--test-cmd` prints `No --test-cmd provided.` and exits 1; the other `--lint` and `--test` one-shots exit 0 (`aider/main.py:1053-1073`).
2. **Mechanism evaluated (Pi 1.4.0).** `ctx.shutdown()`, which requests an orderly process exit and returns no status.
3. **Why it cannot.** Pi owns process exit and documents no extension exit-code API.
4. **Why not omit.** Scripts and CI read a one-shot's exit status.
5. **Adapter.** The runtime sets `process.exitCode` to the one-shot status and then calls `ctx.shutdown()`. It never calls `process.exit()`.
6. **Authoritative Pi state.** Pi owns shutdown ordering and cleanup. The adapter only supplies the status Node keeps.
7. **Verification.** `test/lint/oneshot-bind.test.ts` asserts the statuses at the pure boundary. A real `pi` run of `src/index.ts` exits 1 for `--test` without `--test-cmd` and 0 with it.
8. **Delete when.** Pi exposes an extension-set process exit code.

## Skill delivery in the request projection

1. **Behavior.** Aider has no skill mechanism. Its request is exactly the system prompt, examples, read-only files, repository map, done history, current history, and reminder (`aider/coders/base_coder.py` `format_messages`).
2. **Mechanism evaluated (Pi 1.4.0).** Pi's closed `<skill ...>` wrappers in user content, `context_with_system`, and Pi skill loading.
3. **Why it cannot.** Pi attaches skill instructions inside the user message before the maintainer projects the request. Sending them would add a second instruction system to Aider's prompt order, and Pi exposes no hook to decline skill attachment for one extension.
4. **Why not omit.** The request order is verified against pinned Aider output. Foreign wrappers would change the request the ledger claims.
5. **Adapter.** `stripSkillBlocks` removes closed `<skill ...>` wrappers from projected user text and from mention parsing. The rest of the user text is preserved.
6. **Authoritative Pi state.** Pi owns skill loading and delivery to the session.
7. **Verification.** `test/core/skill-blocks.test.ts` covers the strip; `test/core/context.pi.test.ts` compares provider order with pinned Aider output.
8. **Delete when.** Pi lets an extension decline skill attachment, or the maintainer supports Pi skills as a documented superset.

## Model system-prompt prefixes

1. **Behavior.** When a model sets `system_prompt_prefix`, Aider prepends it to the commit system prompt before calling that model (`aider/repo.py:339-352`).
2. **Mechanism evaluated (Pi 1.4.0).** `Model` fields (`contextWindow`, `maxTokens`, `samplingParams`, `promptCache`, thinking maps), `models.json` and `modelOverrides` fields, and `ctx.modelRegistry.complete`, which sends only the messages the caller builds.
3. **Why it cannot.** Pi's model catalog has no per-model system prompt prefix, and an extension cannot attach metadata to a physical model it did not register. Inventing a maintainer-only prefix file would be a new configuration surface rather than a Pi mechanism.
4. **Why not omit.** Ledger row `git.commit.model-prefix` requires the prefix in the commit system prompt.
5. **Adapter.** None. The commit generator sends Aider's commit system prompt unchanged.
6. **Authoritative Pi state.** Pi owns model metadata and provider transport.
7. **Verification.** `test_repo/TestRepo.test_get_commit_message_uses_system_prompt_prefix` maps to the open row, and the rest of the commit-message ladder is verified in `test/git/commit-model.test.ts` and `test/core/commit-message.pi.test.ts`.
8. **Delete when.** Pi model metadata gains a system prompt prefix, or the ledger drops the claim.

## Git repository operations

1. **Behavior.** Aider's `GitRepo` inventories tracked files, checks gitignore, stages new edit targets, dirty-checkpoints before apply, auto-commits whole files with model-authored messages, and undoes session commits (`aider/repo.py`, `aider/commands.py` `raw_cmd_undo`). `/git` prepends `git`, runs with `GIT_EDITOR=true`, shows combined output outside chat, and does not force cwd to the repo root (`aider/commands.py:967-986`).
2. **Mechanism evaluated.** Pi `Host.exec` / `pi.exec` for subprocesses; SessionManager for session facts; no public Git or VCS API in `@earendil-works/pi-coding-agent` 1.4.0 package exports or `.d.ts`. No public shell=True / shell-string exec API on Host.
3. **Why it cannot.** Pi owns no repository index, ignore rules, commit attribution, or soft-reset undo. Extensions cannot call a native `git` port. Host.exec takes argv arrays with `shell: false` in `isolatedExec`; inventing a parallel shell runner would reintroduce injection risk Aider accepted via `shell=True`.
4. **Why not omit.** The git SAR port (`GitPolicy`) is required for edit authorization, inventory, dirty checkpoints, auto-commits, and `/undo`. `/git`, `/commit`, and `/diff` are documented slash commands.
5. **Adapter.** `src/git/` implements `GitPolicy` by running `git` through `Host.exec`, with attribution and `GIT_EDITOR=true` overlays merged over the resolved environment. `/git` splits arguments with `parseQuotedFilenames` and runs argv `git` from `process.cwd()` (not the repo root). Shell metacharacters (`|`, `>`, `$()`) are not evaluated. Commit messages come from `ctx.modelRegistry.complete` with the weak model then the main model and Aider's commit prompt (`aider/models.py:622-623`, `aider/repo.py:326-367`), and the trailer names the main model id (`aider/repo.py:248-252`). Session commit hashes and message-checkpoint SHAs stay on the port instance for `/undo` and `/diff`.
6. **Authoritative Pi state.** Session transcript, model routing, and permissions stay with Pi. Working-tree bytes stay with `WorkingTree`. Git object database stays with the user's repository.
7. **Verification.** `test/git/*-bind.test.ts` covers inventory, authorize, dirty, commit, undo, diffs, commands, and path-trust rows against real temp repositories. Gate claimed FAIL for closed commands/diff/security ids is 0. Observable Aider `/git` tests (`add` / `commit -a -m`) pass under argv execution.
8. **Delete when.** Pi exposes a public repository API covering tracked inventory, ignore checks, staged adds, commits with env attribution, and soft undo, or a documented safe shell-string exec that extensions may use for `/git`, or the maintainer drops Git parity.
