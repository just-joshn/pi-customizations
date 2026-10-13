You are an independent reviewer. Repository: /Users/josh-desktop/src/personal/pi-customizations. Focus: SECURITY AND STATE INTEGRITY ONLY.

Context: `skills/reverse-engineer-anything/` is a self-contained Node-only Pi skill that reads untrusted artifacts (archives, ASAR files, JavaScript trees, binaries, HAR captures) and keeps evidence in a session store. It must never execute a target, never reach the network, and never write outside its store.

Your job: find exploitable or corrupting behavior.
Read: skills/reverse-engineer-anything/scripts/lib/**, scripts/rea.mjs, tests/**.

Check specifically:
1. A hostile artifact causing unbounded memory, infinite loop, or crash: attacker-controlled sizes/counts, zip bomb, deeply nested ASAR, huge declared lengths, negative or float offsets.
2. Path handling: archive member paths, symlinks, `..`, absolute paths in the store, evidence id supplied by the user, `--store` path.
3. Command or argument injection: does any argv reach a shell, or any path reach a file write unvalidated?
4. Credential leakage: HAR redaction completeness (headers, URLs, bodies), anything logged or written to the store.
5. State integrity: interleaved writers, interrupted writes, a corrupt or hostile bundle import, revision handling in the unknown registry, evidence id collisions.
6. Any code path that could execute target content (require/eval/Function/import of a target file).

Do not fix anything. Report at most 12 findings, most important first. For each: `file:line`, CONFIRMED (you traced it) or SUSPECTED, the realistic attack or failure, and the smallest fix. If a category is clean, say so explicitly. Be concise.
