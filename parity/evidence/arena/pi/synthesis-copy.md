# Synthesis: parseQuery

Base: c1 (split/map/reduce). Candidates: 2, both completed, no dropouts.

Why c1: ~30 lines, smaller API, trivially extensible; c2 is ~90 lines of hand-rolled UTF-8 validation. Both met every basic requirement (leading ?, empty pairs, first '=', '+' then percent order, null-prototype result, non-string input).

Cross-judge: not run (skipped; parent scored the rubric directly). Rubric: basic parsing, decoding order, malformed tolerance (never throw), partial-validity decoding, prototype safety, size/maintainability.

Graft:
- From c2: behavior of decoding valid escapes adjacent to invalid ones (e.g. `%41%E0%A4` -> `A%E0%A4`; c1 left the entire run literal). Ported not as a hand-written decoder but as a piecewise `decodeRun` (try 1-4 escapes with decodeURIComponent) inside c1's structure.

Rejected:
- c2's single-pass scanner and manual UTF-8 code-point assembly: same behavior, far more code.
- c2 per-case branching; c1 regex/URLSearchParams ideas untouched.

Verification: node script compared synthesized vs c2 and c1 on 12 inputs (mixed query, partial-valid runs, overlong/surrogate bytes, truncated sequences, empty/null/'?'/'&&', `__proto__`). Synthesized matched c2 on all 12; differs from c1 only on the 3 partial-run cases (intended). Result has null prototype, `__proto__` is an ordinary key. No test suite was added.
