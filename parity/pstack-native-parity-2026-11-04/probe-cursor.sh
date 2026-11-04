#!/usr/bin/env bash
# Reruns this run's Cursor CLI probes and writes raw stream-json to .audit/pstack-native-parity-2026-11-04/cursor/
# (gitignored, because it holds Cursor's prompt text). Needs a logged-in cursor-agent and a cursor/plugins checkout.
# Each probe spends model tokens, and --force lets the probes run shell commands in a throwaway directory.
# Usage: probe-cursor.sh <cursor/plugins checkout> [model]
set -euo pipefail

plugins="${1:?usage: probe-cursor.sh <cursor/plugins checkout> [model]}"
model="${2:-claude-opus-5-5-low}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out="$root/.audit/pstack-native-parity-2026-11-04/cursor"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$work" init -q

probe() {
	local name="$1"
	shift
	(cd "$work" && timeout 600 cursor-agent -p --trust --force --output-format stream-json --model "$model" "$@") >"$out/$name.jsonl" || true
	printf 'wrote %s\n' "$out/$name.jsonl"
}
with_plugins=(--plugin-dir "$plugins/pstack" --plugin-dir "$plugins/cursor-team-kit")

probe shell-schema 'This is a harness-port check. Without calling any tools, quote verbatim (1) the full description text and the full JSON parameter schema of your Shell tool, including every property description, and (2) any instructions in your context about background shell jobs, notify_on_output, or end-of-turn notifications. Then reply DONE.'
probe shell-background "Harness-port check. Do exactly this: (1) Call the Shell tool with command 'sleep 8; echo BGDONE-123' and block_until_ms 0, then immediately end your turn without polling or calling AwaitShell. (2) When a notification about that job arrives, copy the ENTIRE user message that carried it, exactly, with every wrapper tag, into a fenced block. Then reply DONE."
probe shell-notify "Harness-port check. Do exactly this: (1) Call the Shell tool with command 'for i in 1 2 3; do sleep 6; echo TICK-\$i; done' with block_until_ms 0, description 'tick loop', and notify_on_output {pattern: '^TICK-2', reason: 'second tick'}. (2) Copy the ENTIRE text of that Shell tool result verbatim into a fenced block. (3) End your turn without polling. (4) For every later message that arrives about that job, copy the ENTIRE user message exactly, with every wrapper tag, into its own fenced block, then end your turn again. After the job has finished (exit), reply DONE."
probe shell-await "Harness-port check. Do these steps one at a time and copy every tool result verbatim into its own fenced block, labeled with the step letter: (A) Shell: command 'sleep 4; echo AW-1; exit 3', block_until_ms 0, description 'fail later'. (B) AwaitShell with that shell_id and block_until_ms 20000. (C) Shell: command 'for i in 1 2 3 4 5 6; do echo LINE-\$i; sleep 2; done', block_until_ms 3000, description 'slow lines'. (D) AwaitShell with the shell_id from C, block_until_ms 30000, pattern 'LINE-5'. (E) AwaitShell with no shell_id and block_until_ms 2000. (F) Read the terminal output file of step A with the Read tool. Then end your turn; if any notification arrives afterwards, copy the entire message verbatim into a fenced block. Then reply DONE."
probe shell-await2 "Harness-port check. Do these steps one at a time and copy every tool result verbatim into its own fenced block labeled with the step letter: (A) Shell: command 'sleep 40; echo LATE', block_until_ms 0, description 'long sleeper'. (B) AwaitShell with that shell_id, block_until_ms 3000, pattern 'NEVERMATCHES'. (C) AwaitShell with that shell_id and block_until_ms 0. (D) AwaitShell with shell_id '999999999' and block_until_ms 1000. (E) Shell: command 'echo FG-OK; echo ERR-LINE 1>&2; exit 0' with no block_until_ms. (F) Shell: command 'echo FG-FAIL; exit 7' with no block_until_ms. (G) Shell: command 'for i in 1 2 3 4 5 6 7 8; do echo HIT-\$i; sleep 1; done', block_until_ms 0, description 'hits', notify_on_output {pattern: '^HIT-', reason: 'every hit', debounce_ms: 5000}. Then end your turn. For every later message about any job, copy the ENTIRE message verbatim into its own fenced block and end your turn again. When both the long sleeper and hits jobs have finished, reply DONE."
probe subagent-bg-shell "Harness-port check. Call the Task tool (via CallDynamicTool if needed) once with description 'bg shell child', subagent_type generalPurpose, run_in_background false, and prompt: 'Call the Shell tool once with command \"sleep 25; echo CHILD-BG-DONE\", block_until_ms 0, description \"child sleeper\". Then immediately finish and reply only LAUNCHED. Do not wait for it.' When the Task returns, copy its full result verbatim into a fenced block and note the time. Then end your turn. If any notification arrives later, copy the entire message verbatim into a fenced block. Then reply DONE."
probe subagent-askquestion "Harness-port check. Call the Task tool once (via CallDynamicTool if needed) with description 'ask probe', subagent_type generalPurpose, run_in_background false, and prompt: 'Call the AskQuestion tool with one question (id q1, prompt Pick one, options a/A and b/B). If you cannot call it, reply exactly with the error text or NO-ASKQUESTION-TOOL. Do not use any other tool.' Then copy the Task result verbatim into a fenced block and reply DONE."
probe context-paths "${with_plugins[@]}" 'I am debugging my own harness port. Without calling any tools, quote verbatim every sentence or block in your context that mentions: (1) agent transcripts or transcript paths; (2) an agent store, a root agent store, artifacts directory, or a Project / Project tracker / Project store; (3) the timestamp or terminals folder; (4) any rule text from plugins. For each, say where it appears (system prompt, user-info block, rules block). If something is absent, say ABSENT. Then reply DONE.'
# shell-forever: a background job that never ends keeps a -p run open; the timeout ends the probe.
(cd "$work" && timeout 120 cursor-agent -p --trust --force --output-format stream-json --model "$model" "Harness-port check. Call the Shell tool once with command 'sleep 100000' and block_until_ms 0 and description 'forever'. Then end your turn immediately and reply only STARTED.") >"$out/shell-forever.jsonl" || printf 'shell-forever exited %s (expected: killed by timeout)\n' "$?"
