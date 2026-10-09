# PLAYBOOK: note-store persistence migration

## Done predicate (falsifiable)
From the fixture cwd, with notes.json deleted, `node src/cli.js` run twice:
1. Exits 0 and creates notes.json holding valid JSON with entries for `alpha` and `beta`, each with an ISO-8601 `createdAt`.
2. Every printed line matches `^- <ISO-8601 ms Z> <text>$` (format dictated by existing verify.mjs, which is the gate; `node verify.mjs` must print PASS; baseline is FAIL/no notes.json).
3. Second run prints the same timestamps (loaded from disk, not regenerated) and the notes.json bytes are unchanged.
4. A note added via `store.add` then reloaded by a new store appears in `list()`.
5. Nothing outside fixture cwd edited except the requested done.txt.

## Rigor
Low-medium: three small reversible files in a fixture, no one-way doors. No arena/architect; no fan-out. Gate = a check script run against a pre-change baseline.

## Phases
1. Baseline: capture current `node src/cli.js` output (`- alpha`, `- beta`) into .audit/baseline.txt.
2. Harness: existing verify.mjs (run on baseline to confirm it FAILs), plus ad-hoc reload check for item 4.
3. store.js: file-backed (`createStore({file})`), entries `{text, createdAt}`, `list()` still returns strings; add `entries()`; seeds written on first run.
4. format.js: `formatNote(text, createdAt)` -> `- ISO text`.
5. cli.js: load from notes.json (path resolved relative to cwd-independent project root), print.
6. Verify with check.sh, compare to baseline, write done.txt.

Decision trail: decisions.tsv.
