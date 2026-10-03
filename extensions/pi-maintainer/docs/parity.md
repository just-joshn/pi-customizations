# Parity contract

This file is the maintained record of what `pi-maintainer` reproduces, what it reproduces differently, and
what Pi cannot express.

## Source of truth

The behavior is ported from the reconstruction report at
`~/Documents/DOCS/05-automated-lint-and-test-repair.md`, which describes a pinned
upstream revision `5dc9490bb` (2026-05-22). In scope is everything the report lists as in scope: the
linter module, the lint and test steps of the post-edit pipeline, the reflection loop as it applies to
lint and test failures, the `/lint`, `/test` and `/run` commands, the one-shot lint and test modes, the
lint and test options, the lint and test text in the system prompt, and the two shell runners.

Out of scope, matching the report's own boundary: the general edit loop and edit-format errors beyond the
shared reflection budget, and commit mechanics.

## Method

Line-by-line reading of the report against a checkout at the pinned revision, then golden recordings.
The recordings live in `test/fixtures/` and were produced by running the reference linter at the pinned
revision over four fixtures. Paths were normalized (`<python>` for the interpreter, `<D>` for the scratch
directory) so the fixtures are portable. `test/linter.test.ts` and `test/tree-context.test.ts` compare
this implementation's output to those recordings byte for byte.

Nothing below claims runtime parity for a path that only has a unit test. The end-to-end evidence is the
runtime record in `docs/runtime-verification.md`.

## Mechanism map

| Reference concept | Pi mechanism |
| --- | --- |
| Per-repo linter object | `Linter` class in `src/linter.ts`, constructed per session from `ctx.cwd` |
| Post-edit pipeline | `turn_end` handler, which fires once per model reply including its tool results |
| Reflection as the next user turn | `turn_end` returning `{ entries, continue: true }`; the entries project to `user` messages, so the failure text becomes the next user turn |
| Reflection counter | Session-branch state in the extension, reset in `before_agent_start` (the per-user-message boundary) |
| Terminal messages | `ctx.ui.notify` when a dialog UI exists, else a durable session entry |
| Confirmation prompts | `ctx.ui.confirm`, with the auto-yes and no-UI rules in `src/reflection.ts` and `index.ts` |
| Editor prefill (`placeholder`) | `ctx.ui.setEditorText` in TUI mode |
| System-prompt lint and test text | `before_agent_start` mutating `systemPromptOptions.sections`, the documented structured prompt hook |
| `/lint`, `/test`, `/run` | `pi.registerCommand` |
| `--lint`, `--test`, `--lint-cmd`, `--test-cmd`, `--auto-lint`, `--auto-test`, `--yes-always` | `pi.registerFlag` and `pi.getFlag` |
| `/lint`'s cleared-history repair session | `ctx.newSession({ withSession })`, which replaces the session with an empty one and returns to the original file afterwards |
| Git dirty-file list | `git diff --name-only` and `git diff --name-only --cached` through `pi.exec` |
| Model-suggested shell commands | Not ported. Pi's model calls the bash tool directly, so there is no shell block to collect. |

## Behavior matrix

Status values: **ported** means the reference behavior has an implementation and a test; **ported with a
documented difference** means the observable behavior matches and a gap entry explains a mechanism
difference; **n/a** means out of scope or unreachable on Pi.

| Report section | Behavior | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| 4.1 | Automatic lint after every editing turn, on by default, off with `--no-auto-lint` | `index.ts`, `src/session.ts`, `src/reflection.ts` | `test/reflection.test.ts`, `test/extension-session.test.ts` | ported |
| 4.1 | Automatic test after every editing turn, needs `--test-cmd` and `--auto-test` | `index.ts`, `src/session.ts`, `src/reflection.ts` | `test/reflection.test.ts`, `test/extension-commands.test.ts` | ported |
| 4.1 | `/lint`, `/test`, `/run` | `src/commands.ts` | `test/commands.test.ts` | ported |
| 4.1 | One-shot `--lint` and `--test` | `src/one-shot.ts` | `test/one-shot.test.ts` | ported |
| 4.1 | Benchmark harness | none | none | n/a, see NG-10 |
| 6.1 | `--lint-cmd` parsing, one global command, error text and exit 1 | `src/parse-lint-cmds.ts`, `src/session.ts` | `test/parse-lint-cmds.test.ts`, `test/extension-session.test.ts` | ported |
| 6.2 | Pipeline order: lint, lint confirm, test, test confirm | `src/reflection.ts` | `test/reflection.test.ts` | ported |
| 6.2 | A failed edit skips lint and test and shares the reflection budget | `src/reflection.ts`, `src/session.ts` | `test/reflection.test.ts`, `test/edit-failure.test.ts` | ported |
| 6.2 | Declining the lint prompt still runs the test step | `src/reflection.ts` | `test/reflection.test.ts` | ported |
| 6.3 | `lint_edited`: skip empty names, resolve against the root, join with surrounding newlines, warn, no exception handler | `src/linter.ts` | `test/linter.test.ts` | ported |
| 6.4 | Dispatch order: explicit command, known language, global command, per-language entry, tree-sitter fallback | `src/linter.ts` | `test/linter.test.ts` | ported |
| 6.5 | Python runs tree-sitter, `compile()` and the fatal-only linter subset, merging text and line sets | `src/linter.ts`, `src/python-compile.ts`, `src/flake8.ts` | `test/linter.test.ts`, `test/python-compile.test.ts`, `test/flake8.test.ts` | ported |
| 6.6 | Custom commands append the quoted relative file name, use the repository root, and report `## Running:` plus output on a non-zero exit only | `src/linter.ts`, `src/shell-quote.ts` | `test/linter.test.ts`, `test/shell-quote.test.ts` | ported |
| 6.7 | The marked-line excerpt with enclosing scopes, `loi_pad` 3, no child context, no last line | `src/tree-context.ts` | `test/tree-context.test.ts`, `test/golden-tree-context.test.ts` against recorded excerpts | ported |
| 6.8 | `/lint`: repository required, arguments ignored, in-chat files then dirty files, per-file question, one cleared-history repair session | `src/commands.ts`, `src/lint-queue.ts` | `test/commands.test.ts`, `test/lint-queue.test.ts` | ported |
| 6.9 | `/run`: ask with the token estimate, add on yes, prefill on a failing added run | `src/test-run.ts`, `src/commands.ts` | `test/test-run.test.ts` | ported with a documented difference, see NG-1 and NG-7 |
| 6.9 | `/test`: fall back to the configured command, add on a non-zero exit, return the failure text | `src/test-run.ts`, `src/commands.ts` | `test/test-run.test.ts`, `test/commands.test.ts` | ported |
| 6.10 | A string test failure reaches the model twice | `src/reflection.ts`, `src/commands.ts` | `test/reflection.test.ts` | ported with a documented difference, see NG-1 |
| 6.11 | One-shot `--test` runs the command, adds failing output, calls no model, exits 0 | `src/one-shot.ts` | `test/one-shot.test.ts` | ported |
| 6.13 | Cap of three reflections, warning text, fourth payload shown but dropped | `src/reflection.ts` | `test/reflection.test.ts` | ported |
| 7 | Exact strings: header, questions, warning, run-output template, added-output line, parse errors | `src/strings.ts` | `test/strings.test.ts` | ported |
| 8.1 | Dispatch consequences: global overrides all, `python:` replaces the Python stack, unknown and TypeScript get nothing | `src/linter.ts`, `src/basic-lint.ts` | `test/linter.test.ts` | ported |
| 8.2 | Tree-sitter records the start row of every error and missing node | `src/basic-lint.ts` | `test/basic-lint.test.ts` | ported |
| 8.3 | Line-number extraction from tool output, first file, 1-indexed to 0-indexed, full text kept | `src/lint-regex.ts` | `test/lint-regex.test.ts` | ported |
| 8.4 | Reflection loop: clear, send, stop when nothing reflected, cap, increment, resend | `src/reflection.ts` | `test/reflection.test.ts` | ported |
| 8.5 | Output-to-chat decision: ask, add on non-zero, prefill only for an added failing run | `src/test-run.ts` | `test/test-run.test.ts` | ported |
| 8.6 | Only the exit status counts as a test failure, and an empty command makes the outcome true without running anything | `src/reflection.ts`, `src/test-run.ts` | `test/reflection.test.ts` | ported |
| 8.7 | Command execution through a shell with merged error output, in the repository root | `src/run-command.ts` | `test/run-command.test.ts` | ported with a documented difference, see NG-9 and NG-15 |
| 8.8 | Benchmark test commands and output cleanup | none | none | n/a, see NG-10 |
| 9 | Options and defaults, including the auto-yes rules | `index.ts`, `src/confirm.ts`, `src/session.ts` | `test/extension-session.test.ts`, `test/confirm.test.ts` | ported |
| 9 | Lint and test text in the system prompt, in command-line order | `src/platform-info.ts`, `src/parse-lint-cmds.ts` | `test/platform-info.test.ts` | ported |
| 10 | Robustness: unreadable file, unloadable parser, deep tree, checker exception, empty checker output | `src/linter.ts`, `src/basic-lint.ts`, `src/flake8.ts` | `test/linter.test.ts`, `test/basic-lint.test.ts`, `test/flake8.test.ts` | ported with one documented improvement, see NG-13 |
| 10 | Cost control: the reflection cap and the confirmations | `src/reflection.ts` | `test/reflection.test.ts` | ported |
| 10 | Cancellation of blocking checker and test commands | `src/run-command.ts` | `test/run-command.test.ts` | ported as an addition, see NG-15 |
| 10 | Portability of file-name quoting | `src/shell-quote.ts` | `test/shell-quote.test.ts` | ported |
| Appendix B | Experiments 1, 2 and 3: the exact lint text for a Python syntax error, a Python undefined name, and a JavaScript syntax error | `src/linter.ts` and the checker modules | `test/golden-lint.test.ts` against `test/fixtures/lint-*.txt` | ported |
| Appendix B | Experiment 4: the compile failure without a line number, and the duplicated test message | `src/python-compile.ts`, `src/reflection.ts` | `test/python-compile.test.ts`, `test/reflection.test.ts` | ported with a documented difference, see G-1 and NG-1 |
| Appendix B | Experiment 5: four sends then the cap warning, and the parser's lowercase-only language prefix | `src/reflection.ts`, `src/parse-lint-cmds.ts` | `test/reflection.test.ts`, `test/parse-lint-cmds.test.ts` | ported |
| Appendix B | Experiment 6: one-shot `--test` prints the failing output, adds it, and exits 0 | `src/one-shot.ts` | `test/one-shot.test.ts` | ported |

## Gotcha register

The report's section 13 numbered the reference's defects. This table records what the port does with each
one. `G-n` refers to the same numbering as the report.

| # | Reference defect | Port behavior |
| --- | --- | --- |
| G-1 | A compile error without a line number raises through the linter and ends the session | Reproduced in effect. The check runs in a Python subprocess that fails the same way, and the failure propagates out of the checker. Pi contains a throwing extension handler and reports it, so the session survives where the reference ended. Test: `test/python-compile.test.ts`. |
| G-2 | One-shot `--test` no longer repairs and exits 0 on failing tests | Reproduced exactly. Test: `test/one-shot.test.ts`. |
| G-3 | One-shot `--lint` always exits 0 | Reproduced exactly. Test: `test/one-shot.test.ts`. |
| G-4 | A string test failure is sent twice | Reproduced. Both copies reach the model. The acknowledgement message the reference places between them cannot be injected, see NG-1. Test: `test/reflection.test.ts`. |
| G-5 | `/lint <file>` ignores the file | Reproduced. The command never reads its arguments. Test: `test/commands.test.ts`. |
| G-6 | `/lint` commits unrelated dirty files, and its repair session keeps automatic linting and testing so repairs can nest | The commit half is out of scope, see NG-14. The nesting is reproduced, because the repair runs in a session where the extension is active and each repair message gets its own reflection budget. Test: `test/commands.test.ts`. |
| G-7 | Repair history leaks across files in `/lint` | Reproduced. Every accepted file's repair runs in the one session created on the first acceptance. Test: `test/commands.test.ts`. |
| G-8 | The reflection budget is shared by lint, test and edit-format errors | Reproduced. One counter per user message, and a failed edit skips the step while still spending budget. Test: `test/reflection.test.ts`. |
| G-9 | Accepting a lint repair skips tests for that response | Reproduced. Test: `test/reflection.test.ts`. |
| G-10 | TypeScript is never checked, although language documentation claims otherwise | Reproduced. `src/basic-lint.ts` returns nothing for TypeScript and the language table still maps `.ts` and `.tsx`. Tests: `test/basic-lint.test.ts`, `test/languages.test.ts`. |
| G-11 | Tree-sitter failures carry no message, so the model sees marked lines and two blank lines | Reproduced, and visible in the recorded JavaScript fixture. Test: `test/linter.test.ts`. |
| G-12 | Documentation drifted from the code | Not applicable. This package ships its own documentation and this file records the drift. |
| G-13 | The lint and test outcome fields are write-only | Reproduced. The fields exist in the per-message state and nothing reads them. |
| G-14 | A formatter that rewrites files and exits non-zero is read as a lint failure | Reproduced. The second commit the reference makes is out of scope, see NG-14. |
| G-15 | A missing linter binary becomes a repair request | Reproduced. A shell that cannot find the command exits non-zero with text, which becomes the failure text. Test: `test/linter.test.ts`. |
| G-16 | The `## Running:` line joins the argument list with spaces and is not shell-safe | Reproduced. The displayed line joins with spaces while the real call passes an argument list. Test: `test/flake8.test.ts`. |
| G-17 | The subprocess runner reads the shell variable and does not use it, so the interactive and piped paths can differ | Reproduced with a difference. The port always uses a piped shell; the interactive path is not ported, see NG-9. |
| G-18 | Checker commands run without confirmation | Reproduced. Checkers run unprompted. Pi's permission layer, not this extension, owns command trust. |
| G-19 | The subprocess runner reads and prints one character at a time | Not reproduced. Output is read in stream chunks, so large outputs are not slowed by per-character reads. |
| G-20 | Test coverage for the feature is thin | Inverted for this codebase. Every behavior row above names a test. |
| G-21 | No visible progress while a slow lint command runs | Reproduced. A checker prints nothing until it finishes. Pi's own turn spinner is the only progress signal. |
| G-22 | A reported crash after dismissing the repair prompt was never reproduced | Not reproduced here either. The decline path is covered by tests: `test/reflection.test.ts`, `test/commands.test.ts`. |

## Native-gap register

Each entry states the required behavior, the Pi mechanism that was evaluated, why the public API cannot
express it, what ships instead, which Pi state stays authoritative, and the condition that would let the
adapter be deleted. This is the documented native-gap gate required by `extensions/AGENTS.md`.

### NG-1. Assistant acknowledgement messages

Required: the reference appends `assistant` messages reading `Ok.` after added run output and `Ok` after
shared shell output, and the model sees them as assistant turns.

Evaluated: `pi.sendMessage`, `pi.sendUserMessage`, message-entry drafts returned from `turn_end`.

Why it cannot: `pi.sendMessage` accepts a custom message with no role field, and a custom message projects
to the `user` role. No public API appends an assistant turn, and assigning into the session's message
array is a hard ban.

What ships: the user-role half of the pair, so both copies of a failing test's output reach the model
exactly as the reference produces them. The acknowledgement is absent.

Authoritative Pi state: the session manager and its projection.

Deletion condition: a public API that appends an assistant-role message.

### NG-2. The `!` alias for `/run`

Required: typing `!cmd` in the chat runs `cmd` and asks before adding its output to the context.

Evaluated: the `user_bash` event, with `result` and with `operations`.

Why it cannot: Pi's `!` handling records the bash result into the session through its own path before any
extension can inspect it, and `excludeFromContext` comes from the user's `!` or `!!` prefix. Intercepting
the event and returning a result still records the output, so the ask cannot change the outcome. No
post-run hook exposes the recorded message. Replacing Pi's execution to avoid the recording was rejected
because it drops Pi's streaming, truncation and abort handling and duplicates a Pi-owned mechanism.

What ships: `/run` with the reference's ask-and-add behavior, and Pi's native `!` and `!!` untouched.

Authoritative Pi state: Pi's bash execution and session recording.

Deletion condition: a public hook that can keep or drop a user bash result from the model context.

### NG-3. Model-suggested shell commands

Required: the model emits shell blocks in its reply, they run after lint and before test, and they join the
chat with an `Ok` acknowledgement.

Evaluated: the edit-block reply format.

Why it cannot: Pi has no shell-block edit format. The model calls the bash tool, which Pi executes,
permits and records under its own pipeline.

What ships: nothing. The pipeline's shell step is the model's own tool call.

Authoritative Pi state: Pi's tool execution and permission path.

Deletion condition: an edit format that collects shell blocks.

### NG-4. A callable test command

Required: an embedding API may pass a callable as the test command, and its returned error text is used
without touching the chat history.

Evaluated: `pi.registerFlag` and the extension API surface.

Why it cannot: extension flags are strings or booleans, and no extension-facing seam takes a caller-owned
function per session.

What ships: string commands only.

Authoritative Pi state: the session's flag values.

Deletion condition: a public per-session option that accepts a function.

### NG-5. A repeatable `--lint-cmd`

Required: the flag can be passed several times, and the order is preserved in both dispatch and the system
prompt.

Evaluated: `pi.registerFlag`.

Why it cannot: a registered flag holds one value, and Pi applies a later occurrence over an earlier one.

What ships: one flag value whose newlines separate entries, with order preserved.

Authoritative Pi state: Pi's flag store.

Deletion condition: repeatable flag registration.

### NG-6. Environment variable and config-file surface

Required: every long option also has an environment variable and a config-file key.

Evaluated: `pi.getFlag`, Pi settings.

Why it cannot: extension flags are read through `pi.getFlag`, which reflects the command line and Pi's own
settings resolution, not the reference's environment variable prefix or its config file.

What ships: flags plus the `PI_MAINTAINER_PYTHON` environment variable for the interpreter choice.

Authoritative Pi state: Pi's configuration resolution.

Deletion condition: flag values that Pi resolves from settings and environment variables.

### NG-7. Token counting for the add-output question

Required: the question shows the token count of the command output.

Evaluated: `ctx.getContextUsage`, `ctx.modelRegistry`.

Why it cannot: no public API tokenizes an arbitrary string. Context usage reports the session, not a
string.

What ships: a four-characters-per-token estimate, formatted the same way. The estimate is labeled as an
estimate in code.

Authoritative Pi state: none; the estimate is presentation only and never affects behavior.

Deletion condition: a public tokenizer on the model registry.

### NG-8. A positional file list for one-shot `--lint`

Required: the one-shot lint mode accepts the files to lint as command-line arguments.

Evaluated: `pi.registerFlag`, the CLI argument surface.

Why it cannot: extension flags carry no positional file list, and Pi's positional arguments belong to the
prompt.

What ships: one-shot `--lint` lints the repository's dirty files, which is what the reference does when no
file list is given.

Authoritative Pi state: Pi's argument parsing.

Deletion condition: a public per-extension positional argument hook.

### NG-9. The interactive shell runner

Required: on a terminal the test command runs through a pty so interactive commands can prompt.

Evaluated: child process spawning, `ctx.ui`.

Why it cannot: an extension has no public pty runner for command output, and a pty attached to the TUI
would fight the renderer.

What ships: the piped shell runner for every command. Interactive commands belong to Pi's own `!` path.

Authoritative Pi state: Pi's bash execution for interactive use.

Deletion condition: a public pty execution hook.

### NG-10. The benchmark harness

Required: the reference's benchmark builds its own coder and test loop.

Evaluated: nothing. It is a separate program, and the report itself scopes it to its own harness.

What ships: nothing. The extension's one-shot and command surfaces cover the same behaviors.

Authoritative Pi state: not applicable.

Deletion condition: not applicable.

### NG-11. The fatal-lint interpreter

Required: the fatal-lint subset runs through the interpreter that runs the agent.

Evaluated: `process.execPath` and the environment.

Why it cannot: the agent is a Node process; there is no owning Python environment to inherit.

What ships: `PI_MAINTAINER_PYTHON`, defaulting to `python3` on `PATH`. The interpreter must have the linter
module installed for the Python checker to report fatal codes. When it does not, the module's failure text
becomes the lint failure text, which is the reference's behavior for a broken checker.

Authoritative Pi state: the environment the agent runs in.

Deletion condition: none; this is configuration, not an adapter.

### NG-12. Live checker output

Required: the reference streams a checker command's output to the terminal while it runs.

Evaluated: `ctx.ui` primitives and the tool update channel.

Why it cannot: a turn-time handler has no raw terminal channel, and writing to stdout would corrupt the
TUI renderer.

What ships: the checker's output is captured and shown with the failure text after the checker finishes.

Authoritative Pi state: the TUI owns the terminal.

Deletion condition: a public streaming channel for handler-owned subprocess output.

### NG-13. Deep-tree handling

Required: a deep parse tree raises a recursion error, prints `Unable to lint <file> due to RecursionError`
and skips the check.

Evaluated: the tree walk.

Why it differs: the port walks the tree with an explicit stack, so the recursion limit cannot be reached.
The message is unreachable rather than missing.

What ships: an iterative walk that reports the same error and missing nodes at any depth.

Authoritative Pi state: not applicable.

Deletion condition: none; a recursive walk would be a regression.

### NG-14. Commit hooks

Required: the reference commits before linting, commits again after linting to capture formatter rewrites,
and commits around `/lint`.

Evaluated: Pi's git integration.

Why it cannot: Pi has no auto-commit, and the report's own scope statement assigns commit mechanics to a
sibling slice.

What ships: nothing. Edits stay in the working tree. `/lint`'s dirty-file list still reads git state.

Authoritative Pi state: the user's git workflow.

Deletion condition: a documented decision to add commit behavior to this extension.

### NG-15. Cancellation

Required by `extensions/AGENTS.md`: blocking work must honor cancellation. The reference has no
cancellation, so this is an addition rather than a parity behavior.

What ships: an abort signal threaded into the command runners, which kill the child process. Aborting a
turn therefore stops a running checker or test command.

Authoritative Pi state: the operation signal.

Deletion condition: never; this is a requirement of this repository.
