# pi-maintainer for pi

`pi-maintainer` checks the files pi edits and hands the failures back to the model.

After each turn that edits or writes a file, the extension runs a checker over every edited file. A
failing check is printed, confirmed with you, and then sent as the next user turn so the model repairs
it. The loop is capped at three reflections per user message. The same checkers run from `/lint`, a
one-shot `--lint`, and a test command driven by `/test`, `--test`, or `--auto-test`.

The behavior is a Pi-native port of a pinned reference implementation. `docs/parity.md` maps every
in-scope behavior to the code and test that carries it, and lists the places where Pi has no equivalent
mechanism.

## Install

```sh
git clone https://github.com/just-joshn/pi-customizations.git
cd pi-customizations
pi install ./extensions/pi-maintainer
```

If you already have a checkout, run only the `pi install` command from its root and keep the checkout in
place. To load the extension for one session without installing it, pass its directory directly:

```sh
pi -e ./extensions/pi-maintainer --auto-lint --test-cmd "bun test"
```

Reload an existing session with `/reload` after changing the extension.

## What runs when

The pipeline runs at the end of a turn whose model reply edited files, in this order.

1. Lint every edited file when automatic linting is on.
2. On a lint failure, ask `Attempt to fix lint errors?`. Yes sends the failure text as the next user turn
   and skips the test step for this turn.
3. When automatic testing is on, run the test command and add its output to the chat.
4. On a test failure, ask `Attempt to fix test errors?`. Yes sends the failure text as the next user turn.
5. Stop reflecting after three accepted repairs per user message and warn with
   `Only 3 reflections allowed, stopping.`

A turn whose edit or write tool call failed skips lint and test, because the failed edit already needs a
repair.

Linting is on by default. Testing is off by default and needs both `--test-cmd` and `--auto-test`.

## Checkers

| File | Checker |
| --- | --- |
| Python | Tree-sitter syntax scan, `compile()` through a Python subprocess, and a fatal-code-only `flake8` subset |
| Other known languages | Tree-sitter syntax scan |
| TypeScript | Skipped, matching the reference |
| Unknown extensions | Never checked |
| A language with a configured command | That command, with the file name appended as one shell word |

One command without a language prefix overrides every language checker, including the Python stack. A
`python: ...` command replaces the Python stack for Python files.

The failure text sent to the model is a fixed header, the checker output, and an excerpt of the file
with the failing lines marked inside their enclosing scopes.

## Flags

| Flag | Default | Effect |
| --- | --- | --- |
| `--auto-lint` / `--no-auto-lint` | on | Check edited files after each turn. |
| `--lint-cmd "lang: cmd"` | off | Checker per language. Repeat the flag or separate entries with newlines. No prefix sets the global command. |
| `--lint` | off | One-shot: lint, confirm and repair the dirty files in a fresh session, then exit. Always exits 0. |
| `--auto-test` / `--no-auto-test` | off | Run the test command after each editing turn. |
| `--test-cmd "cmd"` | off | Shell command whose non-zero exit counts as a test failure. |
| `--test` | off | One-shot: run the test command, add failing output to the chat, and exit without calling the model. Exits 1 only when no test command is configured. |
| `--yes-always` | off | Answer yes to every repair and output confirmation. Without it, a session with no dialog UI answers yes as well, because the reference treats a non-interactive prompt as its default answer. |

`--lint-cmd` is a single flag value. Pi flags take one value each, so pass newline-separated entries:

```sh
pi --lint-cmd $'python: flake8 --select=E9\nrust: cargo clippy --message-format short'
```

Set `PI_MAINTAINER_PYTHON` to choose the interpreter used for `compile()` and `flake8`. It defaults to
`python3` on `PATH`, which must have `flake8` installed for the Python checker to report the fatal codes.

## Commands

| Command | Behavior |
| --- | --- |
| `/lint` | Lint the files this session edited, or the repository dirty files when it edited none. Asks `Fix lint errors in <file>?` per file and repairs accepted files in a fresh session with empty history, returning to the original session when it has a file. Positional arguments are ignored, matching the reference. |
| `/test [cmd]` | Run the given command, or `--test-cmd` when none is given. Failing output joins the chat and calls the model. |
| `/run cmd` | Run a command and ask `Add <n>k tokens of command output to the chat?` before adding the output. A failing run that you add prefills the editor with `What's wrong? Fix`. |

Pi's own `!` prefix stays native. Pi records the command output into the model context itself and offers
no hook to suppress it, so the reference's `!` alias for `/run` is not reimplemented. Use `!` when you
want the output in context, `!!` when you do not, and `/run` when you want to be asked.

## Verification

```sh
cd extensions/pi-maintainer
bun run typecheck
bun run test
bun run test:coverage
```

`docs/parity.md` records the golden fixtures, the reference revision they were recorded from, and the
runtime evidence.
