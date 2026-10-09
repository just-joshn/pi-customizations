# Claim

Falsifiable form: After reading `parity/evidence/team-kit/fixture-app/probe.txt` with no edits (treatment identical to baseline), the file contents include a line that is exactly the string `VALUE=7` (full-line match; no surrounding whitespace or other characters on that line).

- Condition: file is the workspace `probe.txt` as currently on disk
- Metric: presence of a line equal to `VALUE=7`
- Threshold: exact match count >= 1
- Predicted comparison: baseline and treatment are the same file with no edits; both must contain the exact line (expect match)
