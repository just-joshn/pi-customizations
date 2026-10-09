# Candidate 2 — one-shot inventory lever

## Problem

`corpus/` holds forty large dump files with sparse `MARKER-*` tokens. Success is `out/summary.json` shaped as `{"markers": string[]}` in alphabetical order such that `node scripts/verify.mjs` prints `GUARD-OK`. Verify already owns comparison against `src/markers.json` (eight expected tokens ALPHA..HOTEL), sorts both sides, and writes `evidence/verify-out.txt`. No inventory script exists; producing the summary is the exercise. The non-obvious constraint is context hygiene: dumps must not be pulled into chat, and hand-transcribing markers from memory or from `seed-corpus.mjs` would skip the real inventory. The shape must be a small, rerunnable lever that scans the corpus without becoming a framework.

## Usage (caller's view)

```bash
# from fixture-app root
node scripts/inventory.mjs
node scripts/verify.mjs
# expect: GUARD-OK markers=8
```

Call sites (same process; no library import surface):

```js
// scripts/inventory.mjs entry — operator runs the file
await main();
// side effect: writes out/summary.json
// stdout: e.g. "wrote 8 markers to out/summary.json"
```

```js
// optional local reuse inside the same file only (not exported as a package API)
const markers = await collectMarkers(corpusDir);
await writeSummary(outPath, markers);
```

There is no published module for other packages to import. The consumer is a human or CI shell invoking one script, then verify.

## Shape

**Data.** One value matters: a sorted unique list of marker strings. Intermediate representation is a `Set` of matches from `/MARKER-[A-Z0-9]+/g` (or equivalent) over each dump's UTF-8 text. Output wire shape is exactly `{ markers: string[] }` with `markers` sorted via `Array.prototype.sort` default string order (matches verify's sort).

**Flow.** Single file `scripts/inventory.mjs`, mirroring `verify.mjs` / `seed-corpus.mjs` conventions (`import.meta.url` → root, `node:fs/promises`, `node:path`):

1. Resolve `corpus/` and `out/summary.json` under fixture root.
2. `readdir` corpus; read each `*.txt` (or every dump file present).
3. For each file body, `matchAll` the marker regex; add captures to a `Set`.
4. `[...set].sort()` → `{ markers }` → `mkdir` out + `writeFile` JSON (pretty or compact; verify only parses).
5. Log count and exit 0; throw / exit non-zero on I/O failure.

**Load-bearing decisions.**

- Zero new modules and no `src/` library. One script is the lever, per `principle-build-the-lever` and `principle-laziness-protocol`. Capability (scan, dedupe, sort, write) concentrates behind `main()` — a deep module with a one-command surface, not a shallow stack of load/transform/save files (`design-red-flags`: temporal decomposition and pass-through avoided).
- Deduplicate with `Set` so duplicate tokens across dumps cannot inflate the list; verify compares multiset-as-sorted-array equality with expected length 8.
- Do not import or hardcode `src/markers.json` or the seed `MARKERS` table. Inventory discovers tokens from `corpus/` only; verify remains the oracle (`principle-boundary-discipline`: discovery vs. check stay separate).
- Do not fan out subagents or paste dump bodies into chat (`principle-guard-the-context-window`); the script is the off-thread reader.
- Regex policy lives only inside the inventory script. Verify never learns the pattern — it only compares string lists.

**Interface depth.** Public surface is "run this file." Hidden: path resolution, directory walk, regex extraction, dedupe, sort, JSON write, mkdir. Exposed: CLI invocation and the on-disk summary contract verify already assumes. No options object, no plugin hooks, no streaming API.

**Deliberately does not.** Parallel workers, progress bars, streaming parsers, CLI flags, exportable collectors, caching, or watching the corpus.

## Synthesis decision

Pending orchestrator.

## Tradeoffs accepted

- We accept a single-file script with no unit-testable exports in exchange for minimal surface and zero module graph.
- We accept loading each dump fully into memory in exchange for simplest correct code; forty × ~80-line files are small enough that streaming adds no real value.
- We accept a fixed regex in the script body in exchange for not introducing a shared "marker grammar" module that verify does not need.
- We accept alphabetical sort in the writer even though verify re-sorts, in exchange for matching NOTES' expected shape and making the artifact human-readable.

## Alternatives considered

- **Layered pipeline** (`scan.mjs` → `dedupe.mjs` → `write.mjs` or a `src/inventory/` package): exposes staged APIs callers must sequence; shallow modules and temporal decomposition. Rejected — larger surface, same capability.
- **Hand-copy or seed-table shortcut**: write summary from `seed-corpus.mjs`'s `MARKERS` or from `src/markers.json` without reading corpus. Hides zero discovery work and breaks the fixture's inventory intent. Rejected — not an inventory.
- **Subagent / chat fan-out over dumps**: each agent reads files into context and reports markers. Exposes noise to the main thread and is non-deterministic as a process. Rejected — violates context guard; the lever is the right tool.

## Open questions and risks

- Should the regex allow lowercase or hyphenated suffixes beyond `MARKER-[A-Z0-9]+`, or is the seed's `MARKER-ALPHA` form the only contract?
- If extra non-marker `MARKER-*`-looking noise appears in future dumps, should inventory still emit them (verify would FAIL) rather than filtering to a known set?
- Is `scripts/inventory.mjs` the agreed path, or does the fixture prefer a root-level `inventory.mjs`?

## Next implementation step

Implement `scripts/inventory.mjs` against `sketch.mjs`: fill `collectMarkers` / `writeSummary` / `main`, run it, then `node scripts/verify.mjs` until `GUARD-OK`.
