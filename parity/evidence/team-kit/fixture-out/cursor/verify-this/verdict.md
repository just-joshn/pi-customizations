VERIFIED
Claim: `probe.txt` contains an exact full-line match of `VALUE=7` (baseline read; treatment same file, no edits).

Evidence:
exact-line `VALUE=7`: baseline=present (line 1; bytes `VALUE=7\n`), treatment=present (identical copy; `diff` exit 0), delta=none, threshold=exact line match count >= 1

Reasoning:
Baseline read of `fixture-app/probe.txt` shows a single line that is exactly `VALUE=7`. Treatment used the same file with no edits; byte-identical copies under `baseline/` and `treatment/` and an empty `diff` confirm the match. No confound: measurement was a direct full-line regex check (`^VALUE=7$`) plus byte dump.
