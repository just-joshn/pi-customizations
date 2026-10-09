# Candidate 1 — reusable marker inventory module

## Problem

`corpus/` holds forty large dump files with `MARKER-*` tokens embedded sparsely in noise. The fixture needs `out/summary.json` shaped as `{"markers": string[]}` in alphabetical order so `scripts/verify.mjs` can compare against `src/markers.json` (eight goldens: ALPHA…HOTEL) and print `GUARD-OK`. No inventory path exists yet. The non-obvious constraint is context hygiene: NOTES warn against pulling dump bodies into the chat thread, so the design must keep scanning behind a small module boundary rather than a one-shot shell paste that encourages reading dumps into the agent context. Verify already re-sorts both sides; the inventory still owns uniqueness and a deterministic sorted `MarkerSummary` so the written artifact matches the documented contract.

## Usage (caller's view)

Quickstart (from fixture root):

```bash
node scripts/inventory.mjs
node scripts/verify.mjs   # expect: GUARD-OK markers=8
```

Call sites:

```js
// scripts/inventory.mjs — thin CLI
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryMarkers, writeSummary } from '../src/inventory.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const summary = await inventoryMarkers(join(root, 'corpus'));
await writeSummary(summary, join(root, 'out', 'summary.json'));
```

```js
// tests or other tooling — scan only, no I/O to out/
import { inventoryMarkers } from '../src/inventory.mjs';

const summary = await inventoryMarkers(corpusDir);
// summary.markers === ['MARKER-ALPHA', ... ] sorted, unique
```

```js
// reuse against a different tree without changing scan policy
import { inventoryMarkers, writeSummary } from '../src/inventory.mjs';

const summary = await inventoryMarkers('/path/to/other-corpus');
await writeSummary(summary, '/path/to/out/summary.json');
```

## Shape

**Data**

- `MarkerSummary` — `{ markers: string[] }` where `markers` is unique, alphabetically sorted, each entry matching `MARKER-<TOKEN>` (uppercase letters after the prefix, matching seed tokens like `MARKER-ALPHA`).
- Wire file `out/summary.json` is exactly that object serialized with stable JSON (no extra fields). Golden expected lives separately under `src/markers.json` as `{ expected: string[] }`; inventory does not read the golden.

**Flow**

1. `inventoryMarkers(corpusDir)` lists files under `corpusDir`, reads each as text, extracts all `MARKER-*` matches, dedupes, sorts, returns `MarkerSummary`.
2. `writeSummary(summary, outPath)` ensures the parent directory exists and writes JSON.
3. `scripts/inventory.mjs` wires fixture paths and calls those two functions; it owns no scan policy.

**Load-bearing decisions**

- Marker pattern, uniqueness, and sort order live only inside `src/inventory.mjs` (principle-boundary-discipline; principle-encode-lessons-in-structure). Callers never see the regex or per-file loop.
- Validation of the token shape happens at extract time inside the inventory module; invalid noise never enters `MarkerSummary.markers`.
- The module deliberately does not compare against `src/markers.json`, does not write `evidence/verify-out.txt`, and does not stream dumps into stdout — verify remains the sole correctness gate.
- Public surface is two functions plus one typedef. Complexity hidden: directory walk, file I/O, match extraction, dedupe, sort. Exposed: corpus path in, typed summary out; optional persist. Interface is no larger than needed for CLI and reuse (principle-subtract-before-you-add).
- Not a pipeline of load/extract/write modules — that would be temporal decomposition. One ownership boundary for “what markers exist in a corpus.”

## Synthesis decision

Pending orchestrator.

## Tradeoffs accepted

- We accept a tiny `src/` module plus thin CLI in exchange for a reusable, testable boundary instead of a single shell one-liner.
- We accept reading whole dump files into memory (forty modest text files) in exchange for simple synchronous-per-file async I/O with no streaming machinery.
- We accept sorting inside inventory even though verify re-sorts, in exchange for `out/summary.json` matching the documented alphabetical contract on disk.
- We accept JSDoc typedefs (no TypeScript in package.json) in exchange for staying on the fixture’s plain ESM stack.

## Alternatives considered

- **Shell one-liner** (`rg`/`grep` + `sort -u` + ad-hoc JSON). Lost: no typed `MarkerSummary`, no reusable import surface, and high risk of dumping corpus into agent context. Hides little policy; exposes tool flags and JSON assembly to the caller.
- **Temporal pipeline** (`listFiles` → `extractFromText` → `toSummary` → `writeJson` as public stages). Lost: shallow interface; callers must coordinate steps and re-learn invariants at each boundary (design-red-flags: temporal decomposition, shallow module).
- **Single mega-function** `runFixtureInventory(root)` with paths hard-coded. Lost: less reusable for alternate corpus roots; couples fixture layout to the inventory capability. Hides more path policy than needed at the cost of a worse import story for tests.

## Open questions and risks

- Should the marker regex allow digits/underscores (`MARKER-[A-Z0-9_]+`) or stay letter-only to match today’s ALPHA…HOTEL seed?
- If a dump ever embeds the same marker twice, is dedupe-by-string (not by file) the confirmed policy?
- Do we need a programmatic export for the pattern later (e.g. shared with seed), or is private regex enough until a second caller appears?

## Next implementation step

Implement `inventoryMarkers` in `src/inventory.mjs` to scan `corpus/`, then wire `scripts/inventory.mjs` to write `out/summary.json` and run `node scripts/verify.mjs`.
