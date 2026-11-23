# Shell: command output and the exec deny rule

The shell feature covers `bash` running a real command in the workspace and the exec policy blocking a
forbidden command before it runs. The proof is the command's stdout and exit behavior, plus the file
state after the denied command.

## Sub-features

- `shell-run` writes and reads a file in one command and returns `shell-ok`.
- `shell-deny` blocks `rm -f out.txt` under `exec deny rm *`.
- `shell-cwd` runs in the workspace, so `out.txt` is the workspace file.
- `shell-error` marks the denied call as an error and leaves the file in place.

## How to get to it (user POV)

- Ask Pi to run a shell command. The model calls `bash` with `command`, and optionally `cwd`,
  `timeout`, and `env`.
- Configure an exec rule in `$PI_CODING_AGENT_DIR/pi-tools.json` to forbid a command pattern.
- Ask Pi to run the forbidden command; the layer refuses it before the process starts.

## Driving it with verify.ts

Preconditions:

- `doctor` prints `doctor: ok`.
- The scenario writes `pi-tools.json` with `exec deny rm *` and `mode: auto`.
- `out.txt` does not exist in the run's workspace.

- **Run the scenario.** From the repo root run
  `bun .agents/skills/verify-pi-tools/scripts/verify.ts run --feature shell`.
  The script prints `feature: shell`, `result: PASS`, and an `evidence:` path.
- **Check the harmless command.** The first `tool_execution_end` is not an error and its text contains
  `shell-ok` from `cat out.txt`.
- **Check the denied command.** The second event has `isError: true` and its text names
  `rule: rm *`.
- **Check the process did not run.** `files.json` still records `out.txt` as `shell-ok`. A missing
  file means the deny rule ran too late.
- **Check the final turn.** `stdout.jsonl` ends with the assistant text `SHELL-OK`.

## Gotchas

- Exec rules match analyzed command segments. `rm -f out.txt` matches `rm *`; ` printf ... > out.txt`
  does not match a deny rule written for another command.
- The shell runs with the workspace as its cwd. A relative path in the command is a workspace path.
- A non-zero exit is an error result even when the policy allowed the command. The scenario's first
  command exits zero.
- The harness never uses the user's shell profile; the temp `PI_CODING_AGENT_DIR` and the command's
  cwd are the only context. Do not add setup that depends on the user's dotfiles.
