# Shell timeout moves a command to the background

`prompt.txt` asks for one foreground shell call with a 5-second timeout on a 12-second loop.

## Cursor CLI 2026.11.05-86047df

`run-1.jsonl` and `run-2.jsonl` ran it with `cursor-agent -p --trust --force --output-format stream-json`. The model passed `timeout: 5000`, Cursor's millisecond unit. In both runs the call returned after about 5 seconds with `tick 1` to `tick 5`, a shell ID, a PID, and `backgroundReason: SHELL_BACKGROUND_REASON_TIMEOUT`. The command kept running, and its completion arrived after about 12.5 seconds with exit code 0.

## Pi with this change

- `pi-seconds-run-1.jsonl` ran `pi-seconds-prompt.txt`, the same request without "5000 ms", through Pi 1.5.0 with `--no-extensions -e extensions/pi-pstack -e extensions/pi-anthropic-oauth/src/index.ts --model claude-subscription/claude-sonnet-4-5 --mode json`. The model passed `timeout: 5`. The call returned "The command did not complete in 5000ms and was sent to the background." with `tick 1` to `tick 5`, a shell ID, a PID, and the output file. `AwaitShell` then reported completion after 12138 ms with exit code 0.
- `pi-run-1.jsonl` and `pi-run-2.jsonl` ran the byte-identical `prompt.txt`. The model passed `timeout: 5000`, which Pi's `bash` reads as seconds, so the command finished in the foreground. Cursor's shell takes milliseconds, and its models pass a timeout on every call (30000 in `../shell-probe-2026-11-07/`), so a command longer than 30 seconds moves to the background there. That unit difference remains open.
