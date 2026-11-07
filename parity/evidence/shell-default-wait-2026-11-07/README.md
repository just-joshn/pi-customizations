# A shell call with no wait set moves to the background after 30 seconds

`prompt.txt` asks for one shell call running a 40-second loop, with no time limit named.

- `cursor-run-1.jsonl` is Cursor CLI 2026.11.05-86047df. The model passed Cursor's default `timeout: 30000`. The call returned "The command did not complete in 30000ms and was sent to the background." with ticks 1 to 30, and the job finished after 40.9 seconds with exit code 0.
- `pi-run-1.jsonl` and `pi-run-2.jsonl` are Pi 1.5.0 with this change (`--no-extensions -e extensions/pi-pstack -e extensions/pi-anthropic-oauth/src/index.ts --model claude-subscription/claude-sonnet-4-5 --mode json`). In run 1 the model set no timeout. The call returned the same moved text after 30000 ms, and `AwaitShell` reported completion after 40.4 seconds with exit code 0. In run 2 the model chose a 50-second timeout, so the loop finished in the foreground with the full output. Both runs end with the full output and exit code 0.
