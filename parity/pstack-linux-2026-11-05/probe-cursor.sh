#!/usr/bin/env bash
# Observes the reference host: Cursor CLI with pstack installed (~/.cursor/plugins/local/pstack) and cursor-team-kit
# loaded from the cursor/plugins checkout. Writes raw stream-json to .audit/pstack-linux-2026-11-05/cursor/<probe>.jsonl
# (gitignored: it holds Cursor's own prompt text). Each probe starts one Cursor agent session and spends model tokens;
# the model is the observed product, never a helper that does this run's work.
# Usage: probe-cursor.sh <cursor/plugins checkout> <probe>... (names below; "all" runs every probe)
set -euo pipefail

plugins="${1:?usage: probe-cursor.sh <cursor/plugins checkout> <probe>...}"
shift
model="${PROBE_MODEL:-claude-opus-5-5-medium}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out="$root/.audit/pstack-linux-2026-11-05/cursor"
mkdir -p "$out"

work="$(mktemp -d /tmp/cprobe-XXXXXX)"
trap 'rm -rf "$work"' EXIT
git -C "$work" init -q
printf 'export const add = (a: number, b: number): number => a + b;\n' > "$work/calc.ts"
git -C "$work" add -A
git -C "$work" -c user.email=probe@example.com -c user.name=probe commit -qm init

run() {
	local name="$1"
	shift
	local started
	started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	(cd "$work" && timeout 600 cursor-agent -p --output-format stream-json --trust --model "$model" \
		--plugin-dir "$plugins/cursor-team-kit" "$@") > "$out/$name.jsonl" || true
	printf '%s\t%s\t%s\t%s\n' "$name" "$started" "$(cursor-agent --version)" "$model" >> "$out/index.tsv"
	printf 'wrote %s\n' "$out/$name.jsonl"
}

probe() {
	case "$1" in
	tools-index) run tools-index 'This is a harness-port check. Call GetDynamicTools exactly once with no arguments. Then, without calling more tools, list every tool name you can call directly (not through GetDynamicTools), one per line, exactly as named. Then reply DONE.' ;;
	task-schema) run task-schema 'Call GetDynamicTools exactly once with namespace "cursor" and toolName "Task". Then reply with only the word DONE.' ;;
	tool-schemas) run tool-schemas 'Call GetDynamicTools exactly seven times in parallel, each with namespace "cursor": toolName "TodoWrite"; "SwitchMode"; "GenerateImage"; "AwaitShell"; "AskQuestion"; "CreatePlan"; "Shell". Then reply DONE.' ;;
	subagent-bg-shell) run subagent-bg-shell "Harness-port check. Call the Task tool (via CallDynamicTool if needed) once with description 'bg shell child', subagent_type generalPurpose, run_in_background false, and prompt: 'Call the Shell tool once with command \"sleep 25; echo CHILD-BG-DONE\", block_until_ms 0, description \"child sleeper\". Then immediately finish and reply only LAUNCHED. Do not wait for it.' When the Task returns, copy its full result verbatim into a fenced block. Then end your turn. If any notification arrives later, copy the entire message verbatim into a fenced block. Then reply DONE." ;;
	subagent-bg-shell-done) run subagent-bg-shell-done "Harness-port check. Call the Task tool (via CallDynamicTool if needed) once with description 'quick job child', subagent_type generalPurpose, run_in_background false, and prompt: 'Call the Shell tool once with command \"sleep 2; echo CHILD-QUICK-DONE\", block_until_ms 0, description \"quick child job\". Then call the Shell tool once with command \"sleep 8\" and block_until_ms 30000. Then reply with FINISHED, followed by every notification or system message you received after your first Shell call, copied verbatim.' When the Task returns, copy its full result verbatim into a fenced block. Then end your turn. If any notification arrives later, copy the entire message verbatim into a fenced block. Then reply DONE." ;;
	subagent-bg-task) run subagent-bg-task "Harness-port check. Call the Task tool (via CallDynamicTool if needed) once with description 'bg task parent', subagent_type generalPurpose, run_in_background false, and prompt: 'Call the Task tool once with description \"grandchild\", subagent_type generalPurpose, run_in_background true, prompt \"Run the shell command sleep 20, then reply with the single word GRANDCHILD-DONE.\" Then immediately finish and reply only LAUNCHED. Do not wait for it.' When the Task returns, copy its full result verbatim into a fenced block. Then end your turn. If any notification arrives later, copy the entire message verbatim into a fenced block. Then reply DONE." ;;
	context-blocks) run context-blocks 'I am debugging my own plugin installation. Without calling tools: (1) list every subagent type named in your <available_subagent_types> block with its exact description text as written there; (2) list every model slug in <available_subagent_models> exactly as written, with any surrounding instructions in that block quoted exactly; (3) show the exact wording and format your context uses to list available skills, and say whether poteto-mode, how, or unslop appear anywhere in that list; (4) quote exactly any rule text you see that comes from a plugin.' ;;
	rule-text) run rule-text 'Harness-port check, no tools. Search your entire context (system prompt, rules, user info, anything before this message) for the exact phrases "inline imports" and "exhaustive switch" or "exhaustive". For each phrase, say FOUND or NOT FOUND, and if found quote the enclosing block verbatim with its surrounding XML tags. Then list the names of every XML tag in your context whose name contains "rule". Then reply DONE.' ;;
	*) echo "unknown probe $1" >&2; return 2 ;;
	esac
}

if [ "${1:-}" = all ]; then
	set -- tools-index task-schema tool-schemas subagent-bg-shell subagent-bg-shell-done subagent-bg-task context-blocks
fi
for name in "$@"; do probe "$name"; done
