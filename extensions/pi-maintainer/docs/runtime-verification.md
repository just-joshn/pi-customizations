# Runtime verification

This file records what was observed on the real artifact: the installed `pi` binary loading this
extension, a scratch repository, and, for the two live runs, a real model.

Produced by `.pi/skills/verify-pi-customizations/bin/control-pi drive pi-maintainer`, whose harness lives
in this repository. Artifacts land in `artifacts/verify-pi-customizations/pi-maintainer/`, which is
gitignored, so the evidence is quoted here as well.

## Deterministic drive

Command.

```sh
./.pi/skills/verify-pi-customizations/bin/control-pi drive pi-maintainer
```

Setup. A scratch directory with one committed Python file, rewritten afterwards so the file is tracked and
modified and contains a syntax error. The session loads the extension with `--yes-always` and a configured
checker, `--lint-cmd "echo target.py:1:1: CUSTOM-LINT-FAILURE; false"`.

| Check | Observation |
| --- | --- |
| Commands registered | `get_commands` returns `lint`, `test`, and `run` with `source: "extension"`. |
| `/lint` finds the dirty file and runs the configured checker | Notification text in `lint.txt` starts `# Fix any errors below, if possible.` and contains `## Running: echo target.py:1:1: CUSTOM-LINT-FAILURE; false target.py`, the checker output, `## See relevant line below marked with █.`, and the marked source line `  1█def broken(`. |
| `/lint` extracts line numbers from checker output and marks them | The same text marks line 1 because the checker printed `target.py:1:1:`. The RPC drive runs with no session file, so this also observes the in-place repair path, `docs/parity.md` NG-16. |
| `/test` adds the exact run-output message | The `maintainer-command-output` entry equals the template filled with the command and `FAILED test_x`. |
| `/run` adds the exact run-output message | The `maintainer-command-output` entry equals the template filled with `echo HELLO` and `HELLO`. |
| One-shot `--test` with a failing command | Exit code 0, the command ran, and the process printed `Added 1 line of output to the chat.` |
| One-shot `--test` without a test command | Exit code 1. |
| Invalid `--lint-cmd` entry | Exit code 1. |

Exit codes are read from pi's default mode. RPC mode exits 0 by its own design, so it cannot report them.

## Live model runs

Both runs used the extension against a scratch repository with the configured default model, print mode,
and `--yes-always`, so confirmations auto-accept the way the reference's scripting mode does.

### Lint reflection

Prompt. Create `target.py` holding exactly two lines, `def broken(` and `    return 1`.

Observed in `~/.pi/agent/sessions/--private-tmp-pm-e2e--/`:

- A `custom_message` entry with `customType: maintainer-reflection` whose content is the full lint text, a
  header, the trimmed compile traceback (`File ".../target.py", line 1` and
  `SyntaxError: '(' was never closed`), the checker command line, and the marked excerpt.
- A `maintainer-output` entry carrying the same text, which is what the user sees.
- The model's next reply quotes the failure: "The `SyntaxError: '(' was never closed` isn't an incidental
  bug". The reflection reached the model.

The model then declined to change the file, because the prompt demanded that exact content. That is the
expected outcome for this prompt and it is what makes the observation unambiguous: the model could only
name that error because the pipeline sent it.

### Test reflection

Prompt. Append one comment line to `target.py`, with `--auto-test` and
`--test-cmd "printf 'FAILED suite\n'; exit 1"`, and a configured checker that passes so the test step runs.

Observed in `~/.pi/agent/sessions/--private-tmp-pm-e2e2--/`:

- A `custom_message` `maintainer-reflection` entry whose content is the run-output template filled with the
  failing command and its output.
- A `maintainer-output` entry reading `Added 1 line of output to the chat.`
- The model's reply names the check outcome, so the test failure reached it.

Both live runs stopped after one reflection because the model's following reply edited no file, which ends
the pipeline by design.

## Not observed at runtime

- The three-reflection cap. The cap belongs to the per-message counter, which is covered by
  `test/reflection.test.ts`; a live run reaches it only when a model edits files on four consecutive
  turns, which a scripted model would have to be forced into. The recorded reference evidence for the cap
  is a stub, not a live model, so the unit test matches that evidence level.
- The pexpect-style interactive command path. Not ported, see `docs/parity.md` NG-9.
- The `!` alias. Pi owns it, see `docs/parity.md` NG-2.
