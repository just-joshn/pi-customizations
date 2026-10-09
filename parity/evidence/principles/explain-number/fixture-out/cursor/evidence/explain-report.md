# Explain report: parser microbench speedup

## Measured speedup

Ratio of means from `data/trials.json` is **4.72x** (baseline mean 413.2 ms / optimized mean 87.6 ms).
`RESULTS.md` rounds this to 4.8x. Do not ship the bare 4.8x without the limiter and trial context below.

Workload: parse 10k synthetic records (`src/parse.js`).

## Named limiter

Profile notes (`data/profile-notes.txt`) say that during the five warm runs, one CPU core stayed near 100% while other cores were idle.
Wall time tracked the single-threaded parse loop in `src/parse.js`.
Not disk, not network, not the load generator.

Why not double: the optimized path is still single-threaded and bound by that one-core parse loop. Doubling throughput would need more than one core on the parse work, or less work per record inside that loop.

## Run count and spread

- Runs: n = 5 warm trials per side (cold-cache first runs discarded; not in the artifact).
- Baseline spread: min 408 ms, max 421 ms.
- Optimized spread: min 84 ms, max 91 ms.
- Trial artifact: `data/trials.json`.

## What else this number could be measuring (ruled out)

| Alternative | Evidence |
| --- | --- |
| Failed or errored requests | Each trial returns a checksum from `parseRecords`; no failure path in the recorded times. |
| Cached or skipped work | Cold first runs were discarded. Warm runs are the only numbers in `data/trials.json`. |
| Untuned baseline | Both sides used the same 10k-record workload; baseline times sit in a tight band (408–421 ms). |
| Run-to-run noise alone | Five trials per side. Spreads are small relative to the gap (baseline ~13 ms range vs ~325 ms mean drop). |
| A tiny piece that does not matter end to end | The profile maps wall time to the parse loop itself, so the measured work is the changed path. |

## Judgment

Trust **~4.7x** as a mean warm-run speedup for this single-threaded microbench, limited by one CPU core in `src/parse.js`.
Do not treat the bare "4.8x" in `RESULTS.md` as enough to ship without stating that limiter and the n=5 / spread evidence.
