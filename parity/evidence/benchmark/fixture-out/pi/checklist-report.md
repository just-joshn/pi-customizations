# Checklist report (ballpark, ONE run)

Verdict: sortFast is faster than sortSlow, but the draft "about 25% faster" does not match this run. One run measured sortSlow 18.53 ms vs sortFast 0.228 ms (~98.8% less time, ~81x). Ballpark only; no range.

- Q4 Did it error? Yes, checked: errorCount=0, both outputs sorted, length 5000 (run-evidence.json).
- Q7 Did it happen? Yes, checked: both sorts ran in the timed region, outputs were verified after timing and workHappened=true. The result is consumed by the checks.
- Caveats: input is a deterministic pattern ((i*17+3)%9973), not random, as the claim says. Sides ran in a fixed order (slow, then fast) with the sides not alternated. Fast ran second, so it may benefit from JIT warmup of shared code, but the gap is far larger than that. Load average ~2.2. Q1-Q3, Q5, Q6 skipped per the ballpark scope (the run does not look wrong; the O(n^2) vs O(n log n) gap is consistent with the numbers, but the limiter was not profiled).
- Suggested claim wording: "sortFast is far faster than sortSlow (~18.5 ms vs ~0.23 ms) on 5000 ints in one run." Drop the 25% figure.
