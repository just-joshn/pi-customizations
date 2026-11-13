# Background shell

The model runs long commands with `bash_background`. The call returns a Shell ID and an output file under the workspace's `terminals/` directory; when the job ends, a `pstack/shell` system notification wakes the session. With `block_until_ms`, a command that finishes in time returns its output directly and sends no notification.

## Sub-features

- `shell-launch`: `Background command started successfully.\nShell ID: N\nPID: N\nCommand: <cmd>\nOutput will be written to <workspace>/terminals/N.txt. Don't mention Shell ID to the user.`
- `shell-file`: the terminal file has a header (`status: succeeded`, ...), `---`, the output, `---`, and `exit_code: 0`.
- `shell-notice`: a `pstack/shell` custom message with `<task>\nkind: shell\nstatus: success\ntask_id: N\ntitle: <description>\ntool_call_id: <id>\n</task>`, then a turn.
- `shell-blocking`: `block_until_ms` long enough returns `Exit code: 7`, then `Command output:` with the output in a fenced block, then `Command completed in N ms.`, and sends no notice.

## How to get to it (user POV)

- Ask the agent to start a dev server, a watcher, or a slow build.
- A plain `bash` call whose timeout elapses moves to the background the same way (not driven here).

## Driving it with control-pstack

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-pstack/bin/control-pstack drive background-shell`.
- **Act.** JSON run with `bash_background {command:"sleep 1; echo BG-DONE", description:"bg probe"}`, then one with `{command:"echo FG-OK; echo ERR-LINE 1>&2; exit 7", block_until_ms:20000}`.
- **Observe.**
  - Launch text matches `shell-launch`, and the output file is under the scratch workspace's `terminals/`.
  - Exactly the `shell-notice` block for that Shell ID; the last assistant text starts `ECHO: <system_notification>`.
  - The terminal file contains `BG-DONE` and the `exit_code: 0` footer.
  - The blocking call returns `shell-blocking` with stdout and stderr interleaved and no `pstack/shell` message.
- **Proof.** `artifacts/verify-pi-pstack/background-shell/`: `terminal-<id>.txt`, `background.events.jsonl`, `foreground.events.jsonl`, `results.json`.

## Gotchas

- Shell IDs are host PIDs, not small counters; do not assert a value.
- The scratch dir is deleted at cleanup, so the drive copies the terminal file into evidence first. Use `--keep` to inspect the live tree.
- `AwaitShell`, `notify_on_output`, and a moved `bash` timeout are not driven; `test/e2e/background-shell.e2e.test.ts` and `shell-timeout.e2e.test.ts` cover them.
