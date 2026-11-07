# Shell state between calls

`prompt.txt` (SHA-256 `d9532aba23396a3ba906c1cc01812b4ec24fb7406e6a89610c8d5ccd02852740`) asks for two separate shell calls: `cd /usr && export PSTACK_PROBE=42`, then `pwd; echo "probe=$PSTACK_PROBE"`.

## Cursor CLI 2026.11.05-86047df

`run-1.jsonl` and `run-2.jsonl` ran it with `cursor-agent -p --trust --force --output-format stream-json` on macOS. In both runs the second shell call's own `stdout` was `/usr\nprobe=42\n`. `edges*-prompt.txt` and `edges*-run-1.jsonl` record the edge cases: failing commands, `exit`, `unset`, plain variables, background commands, and a deleted directory.

## Pi with this change

`pi-run-1.jsonl` and `pi-run-2.jsonl` ran the byte-identical `prompt.txt` through Pi 1.5.0 with `--no-extensions -e extensions/pi-pstack -e extensions/pi-anthropic-oauth/src/index.ts --model claude-subscription/claude-sonnet-4-5 --mode json`. In both runs the model made the same two `bash` calls, and the second call's tool output was `/usr\nprobe=42\n`, the same bytes as Cursor's `stdout` in `run-1.jsonl` and `run-2.jsonl`.
