#!/usr/bin/env python3
"""Write a mixed Pi session: 50 turns of six tool calls each (300 tool rows).

Half the rows call codemode, pi_spawn, and tmux_run, which bench-provider.ts registers without renderers.
Their results hold 20 to 200 lines of text, and a few fail. The other half are read, edit, and bash."""
import json
import sys

out, cwd = sys.argv[1], sys.argv[2]
turns = int(sys.argv[3]) if len(sys.argv) > 3 else 50
entries = []
parent = None
ts = 1794759360000
USAGE = {"input": 30000, "output": 400, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0, "totalTokens": 30400,
         "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}


def add(entry):
    global parent, ts
    ts += 1000
    entry = {"id": f"x{len(entries):04d}", "parentId": parent, "timestamp": "2026-11-15T16:16:00.000Z", **entry}
    entries.append(entry)
    parent = entry["id"]


def assistant(content, stop="toolUse"):
    add({"type": "message", "message": {"role": "assistant", "content": content, "api": "openai-responses", "provider": "openai", "model": "gpt-6.1-sol",
                                        "usage": USAGE, "stopReason": stop, "timestamp": ts}})


def call(cid, name, args):
    return {"type": "toolCall", "id": cid, "name": name, "arguments": args}


def result(cid, name, text, details=None, error=False):
    add({"type": "message", "message": {"role": "toolResult", "toolCallId": cid, "toolName": name, "content": [{"type": "text", "text": text}],
                                        "details": details or {}, "isError": error, "timestamp": ts}})


def line_count(turn, slot):
    return 20 + (turn * 37 + slot * 53) % 181


def codemode_output(turn):
    return "\n".join(f"==> text {i % 3 + 1}/3 <== src/module-{turn}/file-{i}.ts:{i * 7}: export function handler{i}(input: Request) {{" for i in range(line_count(turn, 0)))


def spawn_output(turn):
    head = [f"Job spawn-{turn:03d} exited with code 0.", "", "## Report", ""]
    body = [f"- Checked case {i}: the cache refresh honors the abort signal on path {i % 11}." for i in range(line_count(turn, 1) - len(head))]
    return "\n".join(head + body)


def tmux_output(turn):
    return "\n".join(f"[{i:04d}] vitest run --reporter dot  ✓ suite-{turn}/case-{i}  {i % 9 + 1} ms" for i in range(line_count(turn, 2)))


source = "\n".join(f"{i:4d}  const value{i} = compute(input, {i});" for i in range(1, 61))
diff = "-41 async function refreshCache() {\n+41 async function refreshCache(signal) {"
patch = "--- a/src/cache.ts\n+++ b/src/cache.ts\n@@ -41 +41 @@\n-async function refreshCache() {\n+async function refreshCache(signal) {\n"
bash = "\n".join([*(f" ✓ cache.test.ts > case {i}" for i in range(1, 16)), "", " Test Files  1 passed (1)", "      Tests  15 passed (15)"])
code = "const files = await tools.bash({ command: 'rg -l refreshCache src' });\nconst hits = files.output.split('\\n');\nreturn hits.map((file) => file.trim());"

entries.append({"type": "session", "version": 3, "id": "01a1dffe-0000-7000-8000-000000000003", "timestamp": "2026-11-15T16:15:55.270Z", "cwd": cwd})
add({"type": "model_change", "provider": "openai", "modelId": "gpt-6.1-sol"})
add({"type": "thinking_level_change", "thinkingLevel": "medium"})
for turn in range(turns):
    k = f"t{turn}-"
    add({"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": f"Make cache module {turn} cancelable."}], "timestamp": ts}})
    assistant([{"type": "text", "text": "I'll map the callers, then hand the review to a worker."},
               call(f"{k}code", "codemode", {"code": code}),
               call(f"{k}read", "read", {"path": f"{cwd}/src/session/cache-{turn}.ts"})])
    code_failed = turn % 10 == 9
    result(f"{k}code", "codemode", f"TypeError: tools.bash is not a function\n    at script.js:1:27\n    at run (codemode:{turn})" if code_failed else codemode_output(turn), error=code_failed)
    result(f"{k}read", "read", source)
    assistant([call(f"{k}spawn", "pi_spawn", {"name": f"review-{turn}", "brief": f"Review cache module {turn}.\n\nRead src/session/cache-{turn}.ts and report every caller.", "agent": "poteto-agent"}),
               call(f"{k}edit", "edit", {"path": f"{cwd}/src/session/cache-{turn}.ts", "edits": [{"oldText": "a", "newText": "b"}]})])
    result(f"{k}spawn", "pi_spawn", spawn_output(turn))
    result(f"{k}edit", "edit", f"Successfully replaced 1 block(s) in src/session/cache-{turn}.ts.", {"diff": diff, "patch": patch, "firstChangedLine": 41})
    assistant([call(f"{k}tmux", "tmux_run", {"name": f"tests-{turn}", "command": f"bunx vitest run test/cache-{turn}.test.ts", "wake": "tests done"}),
               call(f"{k}bash", "bash", {"command": "npm test -- cache"})])
    tmux_failed = turn % 15 == 7
    result(f"{k}tmux", "tmux_run", tmux_output(turn) + ("\n FAIL suite timed out\nCommand exited with code 2" if tmux_failed else ""), error=tmux_failed)
    result(f"{k}bash", "bash", bash)
    assistant([{"type": "text", "text": f"Module {turn} now accepts an abort signal. Tests pass."}], stop="stop")

with open(out, "w") as f:
    for e in entries:
        f.write(json.dumps(e) + "\n")
