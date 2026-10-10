# Native gaps

Every custom adapter in pi-maintainer, with the eight answers that `extensions/AGENTS.md` requires before custom logic is added. The answers are, in order: the exact required behavior, the Pi mechanism evaluated, why the public API cannot express the requirement, why omitting the behavior is unacceptable, the smallest adapter, the Pi-owned state that stays authoritative, the verification, and the condition for deleting the adapter.

All citations refer to installed Pi 1.1.0 under `CA` = `@earendil-works/pi-coding-agent/` and to the Aider checkout at `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`.

## Settings

### Option files and environment variables

1. **Behavior.** Aider resolves each option from the command line, then `AIDER_<NAME>`, then `.aider.conf.yml` in the home directory, the Git root, and the working directory (later files win), then an explicit `--config` file above those, then the argparse default (`aider/main.py:464-501`, configargparse `parse_known_args`). pi-maintainer applies the same order with `PI_MAINTAINER_<NAME>` and `.pi-maintainer.conf.yml`.
2. **Mechanism evaluated.** `pi.registerFlag` and `pi.getFlag` for the command line; `pi.getSettings()` for settings.
3. **Why it cannot.** `pi.getSettings()` returns Pi's own merged settings (`CA/dist/core/extensions/types.d.ts:1262`). There is no extension settings namespace, no `registerSettings`, no environment-variable binding, and no Git-root settings layer.
4. **Why not omit.** Aider users configure edit format, dry run, encoding, files, and every later SAR's options through these files and variables. Without them, a configured Aider setup has no equivalent.
5. **Adapter.** `src/settings/`: `config-files.ts` finds the files and parses YAML with PyYAML's scalar typing (`yaml-values.ts`), `sources.ts` converts each source the way configargparse's `convert_item_to_command_line_arg` does, and `resolve.ts` picks the highest-precedence valid value per option.
6. **Authoritative Pi state.** Pi's CLI parsing and flag registry. The adapter reads flags only through `pi.getFlag`, and never reads `process.argv`.
7. **Verification.** `test/settings/settings.oracle.test.ts` runs 52 resolution cases through Aider's own `get_parser` and configargparse with real home, Git-root, and working-directory files, and 12 YAML typing cases through configargparse's `YAMLConfigFileParser`. Reversing the file precedence fails 5 of them.
8. **Delete when.** Pi offers extension-owned settings with environment and project-root layers, or the operator drops Aider's configuration surface.

### `.env` files

1. **Behavior.** Aider loads `.env` from the home directory, the Git root, the working directory, and `--env-file` (default `<git root>/.env`), later files overriding earlier ones and duplicates keeping their last place, with python-dotenv's grammar and `${VAR}` interpolation (`aider/main.py:305-388`). The values feed the second option parse.
2. **Mechanism evaluated.** None in Pi. Pi reads provider credentials itself and offers no dotenv loading to extensions.
3. **Why it cannot.** No Pi API loads `.env` files for an extension.
4. **Why not omit.** `PI_MAINTAINER_*` variables in a project `.env` are a documented way to configure Aider, and the operator decision in `docs/ARCHITECTURE.md` requires them.
5. **Adapter.** `src/settings/dotenv.ts` ports python-dotenv's parser and `resolve_variables`. `load.ts` applies the files to a copy of the environment.
6. **Authoritative Pi state.** Pi's `process.env`. The adapter never writes it, because Aider's `load_dotenv(override=True)` would replace provider credentials that Pi owns. This is a deliberate adaptation: `.env` values reach option resolution and the environment of commands pi-maintainer runs, not Pi.
7. **Verification.** 22 python-dotenv cases and 5 `generate_search_path_list` cases in `test/settings/settings.oracle.test.ts`; `test/settings/load.test.ts` proves `process.env` is untouched.
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
2. **Mechanism evaluated.** Structured `before_agent_start`, `context`, `context_with_system`, and `buildSessionProjection`.
3. **Why it cannot.** Pi has no mid-run structured prompt setter. Conversation-only transforms cannot place system reminders. Context messages lack source-entry IDs.
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
3. **Why it cannot.** Pi 1.1.0 `ExecOptions` has no environment field. Passing `NAME=value` through `env -i` puts those values on argv, which process listings and command logs can expose.
4. **Why not omit.** The architecture requires local dotenv values to reach maintainer commands, and credential material must not appear in argv.
5. **Adapter.** `src/core/isolated-exec.ts` spawns the command with Node's `env` option, an empty inherited environment except the explicit map, and the same cwd, timeout, and abort behavior as `pi.exec`. It never constructs shell text and never puts assignments on argv.
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
