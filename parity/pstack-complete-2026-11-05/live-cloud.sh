#!/usr/bin/env bash
# A real model drives a cloud agent end to end: the parent chat (deepseek-flash, API key, no OAuth refresh) is asked in
# plain words to hand work to a cloud agent; the agent must run on its own container with a fresh clone of the pushed
# remote. Usage: live-cloud.sh <pi-pstack-dir> <receipt-dir>
set -euo pipefail
pkg=$1
out=$2
mkdir -p "$out"
root=$(mktemp -d /tmp/pstack-live-XXXXXX)
agent=$root/agent
work=$root/work
mkdir -p "$agent" "$root/seed"
ln -s "$HOME/.pi/agent/auth.json" "$agent/auth.json"
printf '{"packages":["%s"],"quietStartup":true}\n' "$pkg" >"$agent/settings.json"
git -C "$root/seed" init -q -b main
printf 'LIVE-PUSHED-CONTENT\n' >"$root/seed/README.md"
git -C "$root/seed" add README.md
git -C "$root/seed" -c user.email=t@t -c user.name=t commit -qm 'pushed commit'
git clone -q --bare "$root/seed" "$root/remote.git"
git -C "$root/remote.git" config daemon.receivepack true
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1])')
ip=$(node -e 'for (const l of Object.values(require("os").networkInterfaces())) for (const e of l) if (e.family==="IPv4" && !e.internal) { console.log(e.address); process.exit(0); }')
git daemon --reuseaddr --export-all --base-path="$root" --port="$port" --listen=0.0.0.0 "$root" &
daemon=$!
trap 'kill $daemon 2>/dev/null; docker ps -a --filter label=pstack.agent -q | xargs -r docker rm -f >/dev/null 2>&1; rm -rf "$root"' EXIT
for _ in $(seq 1 50); do git ls-remote "git://$ip:$port/remote.git" >/dev/null 2>&1 && break; sleep 0.1; done
git clone -q "git://$ip:$port/remote.git" "$work"
printf 'LOCAL-UNCOMMITTED\n' >"$work/README.md"
cd "$work"
prompt='Hand this to a cloud agent with the Task tool (environment "cloud", run in the foreground): it must run `hostname`, `cat README.md`, and `git branch --show-current`, and report their output verbatim. Then tell me exactly what it reported.'
HOME=$root PI_CODING_AGENT_DIR=$agent PSTACK_CLOUD_DRIVER=container PSTACK_CLOUD_IMAGE=node:22.22.2-bookworm \
  node "$pkg/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" --mode json --model deepseek/deepseek-flash --no-session -- "$prompt" >"$out/live-cloud-events.jsonl" 2>"$out/live-cloud-stderr.txt" || true
node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const ends = lines.filter((e) => e.type === "tool_execution_end" && e.toolName === "Task");
const task = ends[0];
const text = task ? task.result.content.map((p) => p.text).join("") : "";
const args = lines.filter((e) => e.type === "tool_execution_start" && e.toolName === "Task").map((e) => e.args);
const result = { taskArgs: args, taskIsError: task ? task.isError : null, machine: task ? task.result.details.machine : null, sawPushed: text.includes("LIVE-PUSHED-CONTENT"), sawLocal: text.includes("LOCAL-UNCOMMITTED"), sawContainerHost: /pstack-[0-9a-f]{8}/.test(text), sawBranch: /pstack\/[0-9a-f-]{36}/.test(text) };
require("fs").writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
console.log(JSON.stringify({ taskArgs: args.map((a) => ({ environment: a.environment, run_in_background: a.run_in_background })), taskIsError: result.taskIsError, driver: result.machine && result.machine.driver, sawPushed: result.sawPushed, sawLocal: result.sawLocal, sawContainerHost: result.sawContainerHost, sawBranch: result.sawBranch }));
' "$out/live-cloud-events.jsonl" "$out/live-cloud.json"
