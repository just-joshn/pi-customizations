#!/usr/bin/env python3
"""Write a Pi session that replays the mockup conversation: read, edit, bash pass, bash fail, grep, image read, codemode.

An optional third argument repeats the conversation that many times, for a long transcript."""
import json
import sys

out, cwd = sys.argv[1], sys.argv[2]
repeats = int(sys.argv[3]) if len(sys.argv) > 3 else 1
entries = []
parent = None
ts = 1794759360000


def add(entry):
    global parent, ts
    ts += 1000
    entry = {"id": f"e{len(entries):04d}", "parentId": parent, "timestamp": "2026-11-15T16:16:00.000Z", **entry}
    entries.append(entry)
    parent = entry["id"]


def assistant(content, stop="toolUse"):
    add({"type": "message", "message": {"role": "assistant", "content": content, "api": "openai-responses", "provider": "openai", "model": "gpt-6.1-sol",
         "usage": {"input": 30000, "output": 200, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0, "totalTokens": 30200,
                   "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "stopReason": stop, "timestamp": ts}})


def call(cid, name, args):
    return {"type": "toolCall", "id": cid, "name": name, "arguments": args}


def result(cid, name, text, details=None, error=False, extra=()):
    add({"type": "message", "message": {"role": "toolResult", "toolCallId": cid, "toolName": name, "content": [{"type": "text", "text": text}, *extra],
         "details": details or {}, "isError": error, "timestamp": ts}})


entries.append({"type": "session", "version": 3, "id": "01a1dffe-0000-7000-8000-000000000001", "timestamp": "2026-11-15T16:15:55.270Z", "cwd": cwd})
add({"type": "model_change", "provider": "openai", "modelId": "gpt-6.1-sol"})
add({"type": "thinking_level_change", "thinkingLevel": "medium"})
source = "\n".join(f"line {i}" for i in range(1, 143))
diff = "-41 async function refreshCache() {\n+41 async function refreshCache(signal) {\n-42   return await fetchSnapshot();\n+42   return await fetchSnapshot({ signal });"
patch = "--- a/src/session/cache.ts\n+++ b/src/session/cache.ts\n@@ -41,2 +41,2 @@\n-async function refreshCache() {\n+async function refreshCache(signal) {\n-  return await fetchSnapshot();\n+  return await fetchSnapshot({ signal });\n"
fail = "\n".join(["FAIL cache.test.ts", "  refreshes a snapshot", "  respects cancellation", "    expected aborted, got resolved", "      at cache.test.ts:42:7", "      at runTest (vitest)", "Tests: 1 failed, 1 passed", "", "Command exited with code 1"])

PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
for r in range(repeats):
    k = "" if r == 0 else f"r{r}-"
    add({"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": "Make the cache refresh cancelable."}], "timestamp": ts}})

    assistant([{"type": "text", "text": "I'll check the refresh path and preserve the existing retry behavior."},
               call(f"{k}c1", "read", {"path": f"{cwd}/src/session/cache.ts"}),
               call(f"{k}c2", "grep", {"pattern": "refreshCache", "path": "src"}),
               call(f"{k}c7", "read", {"path": f"{cwd}/docs/flow.png"})])
    result(f"{k}c1", "read", source)
    result(f"{k}c7", "read", "Read image file [image/png]", extra=[{"type": "image", "data": PNG, "mimeType": "image/png"}])
    result(f"{k}c2", "grep", "src/session/cache.ts:41: async function refreshCache() {\nsrc/session/index.ts:12: refreshCache()\nsrc/app.ts:88: await refreshCache()")
    assistant([call(f"{k}c3", "edit", {"path": f"{cwd}/src/session/cache.ts", "edits": [{"oldText": "a", "newText": "b"}]})])
    result(f"{k}c3", "edit", "Successfully replaced 1 block(s) in src/session/cache.ts.", {"diff": diff, "patch": patch, "firstChangedLine": 41})
    assistant([call(f"{k}c4", "bash", {"command": "npm test"})])
    result(f"{k}c4", "bash", fail, error=True)
    assistant([call(f"{k}c5", "edit", {"path": f"{cwd}/test/cache.test.ts", "edits": [{"oldText": "a", "newText": "b"}]}),
               call(f"{k}c6", "bash", {"command": "npm test"})])
    result(f"{k}c5", "edit", "Successfully replaced 1 block(s).", {"diff": "-7 x\n+7 y", "patch": "--- a\n+++ b\n@@ -7 +7 @@\n-x\n+y\n", "firstChangedLine": 7})
    result(f"{k}c6", "bash", "PASS cache.test.ts\n  refreshes a snapshot\n  respects cancellation")
    assistant([{"type": "text", "text": "Refresh now accepts an abort signal.\n\nExisting retries are unchanged. Tests pass."}], stop="stop")

with open(out, "w") as f:
    for e in entries:
        f.write(json.dumps(e) + "\n")
