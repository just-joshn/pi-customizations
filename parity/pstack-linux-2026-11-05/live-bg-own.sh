#!/usr/bin/env bash
# Runs the three background-ownership scenarios of probe-cursor.sh through real Pi with a real model and this checkout's
# pi-pstack (an isolated agent folder whose settings load only the package from this working tree), so a model drives the
# same prompts Cursor CLI received. Writes --mode json events to .audit/pstack-linux-2026-11-05/live/<scenario>.jsonl.
# The provider key comes from `pi auth print-api-key` into the environment of the run only; nothing is written to disk.
# Usage: live-bg-own.sh [model]   (default deepseek/deepseek-flash)
set -euo pipefail

model="${1:-deepseek/deepseek-flash}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out="$root/.audit/pstack-linux-2026-11-05/live"
mkdir -p "$out"
sandbox="$(mktemp -d /tmp/pi-live-bg-XXXXXX)"
trap 'pkill -f "supervisor-main.ts --workspace $sandbox/work" 2>/dev/null || true; rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox/agent" "$sandbox/work"
printf '{"packages":["%s"],"quietStartup":true}\n' "$root/extensions/pi-pstack" > "$sandbox/agent/settings.json"
git -C "$sandbox/work" init -q
DEEPSEEK_API_KEY="$(pi auth print-api-key --provider deepseek)"
export DEEPSEEK_API_KEY PI_CODING_AGENT_DIR="$sandbox/agent" PI_SKIP_VERSION_CHECK=1

run() {
	local name="$1" prompt="$2"
	(cd "$sandbox/work" && timeout 600 pi --mode json -p --model "$model" --no-session "$prompt") > "$out/$name.jsonl" 2> "$out/$name.stderr" || true
	printf '%s\t%s\t%s\n' "$name" "$(date -u +%FT%TZ)" "$model" >> "$out/index.tsv"
	node "$root/parity/pstack-linux-2026-11-05/live-summary.mjs" "$out/$name.jsonl"
}

run subagent-bg-shell "Harness-port check. Call the Task tool once with description 'bg shell child', subagent_type generalPurpose, run_in_background false, and prompt: 'Call the bash_background tool once with command \"sleep 25; echo CHILD-BG-DONE\", block_until_ms 0, description \"child sleeper\". Then immediately finish and reply only LAUNCHED. Do not wait for it.' When the Task returns, copy its full result verbatim into a fenced block. Then end your turn. If any notification arrives later, copy the entire message verbatim into a fenced block. Then reply DONE."
run subagent-bg-shell-done "Harness-port check. Call the Task tool once with description 'quick job child', subagent_type generalPurpose, run_in_background false, and prompt: 'Call the bash_background tool once with command \"sleep 2; echo CHILD-QUICK-DONE\", block_until_ms 0, description \"quick child job\". Then call the bash tool once with command \"sleep 8\". Then reply with FINISHED, followed by every notification or system message you received after your first tool call, copied verbatim.' When the Task returns, copy its full result verbatim into a fenced block. Then end your turn. If any notification arrives later, copy the entire message verbatim into a fenced block. Then reply DONE."
run subagent-bg-task "Harness-port check. Call the Task tool once with description 'bg task parent', subagent_type generalPurpose, run_in_background false, and prompt: 'Call the Task tool once with description \"grandchild\", subagent_type generalPurpose, run_in_background true, prompt \"Run the shell command sleep 20, then reply with the single word GRANDCHILD-DONE.\" Then immediately finish and reply only LAUNCHED. Do not wait for it.' When the Task returns, copy its full result verbatim into a fenced block. Then end your turn. If any notification arrives later, copy the entire message verbatim into a fenced block. Then reply DONE."
