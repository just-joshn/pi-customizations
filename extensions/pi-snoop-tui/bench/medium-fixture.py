#!/usr/bin/env python3
"""Write a medium Pi session: 30 turns of Markdown with code blocks and five tool calls each (150 tool rows)."""
import json
import sys

out, cwd = sys.argv[1], sys.argv[2]
turns = int(sys.argv[3]) if len(sys.argv) > 3 else 30
entries = []
parent = None
ts = 1794759360000
USAGE = {"input": 30000, "output": 400, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0, "totalTokens": 30400,
         "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}


def add(entry):
    global parent, ts
    ts += 1000
    entry = {"id": f"m{len(entries):04d}", "parentId": parent, "timestamp": "2026-11-15T16:16:00.000Z", **entry}
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


def plan(turn):
    return "\n".join([
        f"## Step {turn + 1}: tighten the cache path",
        "",
        f"The **refresh** loop in `cache-{turn}.ts` re-reads the snapshot on every tick. I'll check the callers, then make the fetch cancelable.",
        "",
        "- Read the module and its tests.",
        "- Find every caller of `refreshCache`.",
        "- Patch the signature and rerun the suite.",
        "",
        "```ts",
        f"export async function refreshCache{turn}(signal?: AbortSignal) {{",
        "  const snapshot = await fetchSnapshot({ signal });",
        "  return snapshot.rows.filter((row) => row.visible);",
        "}",
        "```",
    ])


def summary(turn):
    return "\n".join([
        f"### Result for step {turn + 1}",
        "",
        "| Check | Status |",
        "|---|---|",
        "| Unit tests | pass |",
        "| Type check | pass |",
        "",
        "The fetch now honors the abort signal. Retries keep their old backoff:",
        "",
        "```ts",
        "const delay = Math.min(250 * 2 ** attempt, 4000);",
        "await sleep(delay, signal);",
        "```",
        "",
        "> Callers that pass no signal keep the old behavior.",
    ])


source = "\n".join(f"{i:4d}  const value{i} = compute(input, {i});" for i in range(1, 61))
grep = "\n".join(f"src/session/cache-{i}.ts:{i * 3}: await refreshCache()" for i in range(1, 6))
bash = "\n".join([*(f" ✓ cache.test.ts > case {i}" for i in range(1, 16)), "", " Test Files  1 passed (1)", "      Tests  15 passed (15)"])
diff = "-41 async function refreshCache() {\n+41 async function refreshCache(signal) {\n-42   return await fetchSnapshot();\n+42   return await fetchSnapshot({ signal });"
patch = "--- a/src/cache.ts\n+++ b/src/cache.ts\n@@ -41,2 +41,2 @@\n-async function refreshCache() {\n+async function refreshCache(signal) {\n-  return await fetchSnapshot();\n+  return await fetchSnapshot({ signal });\n"

entries.append({"type": "session", "version": 3, "id": "01a1dffe-0000-7000-8000-000000000002", "timestamp": "2026-11-15T16:15:55.270Z", "cwd": cwd})
add({"type": "model_change", "provider": "openai", "modelId": "gpt-6.1-sol"})
add({"type": "thinking_level_change", "thinkingLevel": "medium"})
for turn in range(turns):
    k = f"t{turn}-"
    add({"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": f"Make cache module {turn} cancelable."}], "timestamp": ts}})
    assistant([{"type": "text", "text": plan(turn)},
               call(f"{k}read", "read", {"path": f"{cwd}/src/session/cache-{turn}.ts"}),
               call(f"{k}grep", "grep", {"pattern": "refreshCache", "path": "src"})])
    result(f"{k}read", "read", source)
    result(f"{k}grep", "grep", grep)
    assistant([{"type": "text", "text": "The callers all await the result, so a signal parameter is safe."},
               call(f"{k}edit", "edit", {"path": f"{cwd}/src/session/cache-{turn}.ts", "edits": [{"oldText": "a", "newText": "b"}]})])
    result(f"{k}edit", "edit", f"Successfully replaced 1 block(s) in src/session/cache-{turn}.ts.", {"diff": diff, "patch": patch, "firstChangedLine": 41})
    assistant([call(f"{k}bash", "bash", {"command": "npm test -- cache"}), call(f"{k}read2", "read", {"path": f"{cwd}/test/cache-{turn}.test.ts"})])
    result(f"{k}bash", "bash", bash)
    result(f"{k}read2", "read", source)
    assistant([{"type": "text", "text": summary(turn)}], stop="stop")

with open(out, "w") as f:
    for e in entries:
        f.write(json.dumps(e) + "\n")
