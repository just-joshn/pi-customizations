
## Pi with this change

`pi-run-1.jsonl` and `pi-run-2.jsonl` ran the byte-identical `prompt.txt` through Pi 1.5.0 with `--no-extensions -e extensions/pi-pstack -e extensions/pi-anthropic-oauth/src/index.ts --model claude-subscription/claude-sonnet-4-5 --mode json`. In both runs the model made the same two `bash` calls, and the second call's tool output was `/usr\nprobe=42\n`, the same bytes as Cursor's `stdout` in `run-1.jsonl` and `run-2.jsonl`.
