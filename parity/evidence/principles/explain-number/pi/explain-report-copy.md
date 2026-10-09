# Explain the number

**Measured speedup: 4.7x** (ratio of means 413.2 ms / 87.6 ms = 4.72x). RESULTS.md says 4.8x, which rounds up. Use 4.7x.

**Runs.** 5 runs per side (n=5), warm. Workload: parse 10k synthetic records. Artifact: data/trials.json.

**Spread.**
- Baseline: min 408 ms, max 421 ms.
- Optimized: min 84 ms, max 91 ms.
- Ratio range across extreme pairings: 4.48x (408/91) to 5.01x (421/84). Run-to-run noise is under 4% per side, so the ratio is stable to about 0.5x.

**Limiter.** The optimized path is bounded by the single-threaded parse loop in src/parse.js. In the five warm runs one CPU core sat near 100% while the others idled (data/profile-notes.txt). It is not disk, network, or the load generator. This is why the result is not higher: more cores do not help until the loop is parallelized.

**Other explanations ruled out.**
- Cold cache: cold first runs were discarded, so both sides are warm.
- Failed or skipped work: not checked directly. Neither artifact records output counts or errors for the 10k records. Treat this as an open gap.
- Untuned side: not evidenced either way. Baseline settings are not recorded.
- Noise: spread above is small relative to the gap.
- Piece too small to matter: the parse loop is the whole measured wall time, so the saving is end to end for this workload.

**Caveat.** Synthetic 10k-record workload on one machine. Real input may differ.
