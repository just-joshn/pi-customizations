# u-completion-gate-v1 report

## Verdict

Real gate run on the current tree exits **2** with `verdict: BLOCKED`. No fake pass.

## Artifacts

| Path | Role |
| --- | --- |
| `parity/scripts/check-completion.mjs` | CLI entry |
| `parity/scripts/completion.mjs` | Fail-closed evaluator and atomic `completion.json` writer |
| `parity/test/check-completion.test.mjs` | Unit and live-tree regression tests |
| `parity/completion.json` | Written by the real failing run |
| `parity/briefs/reports/u-completion-gate-v1-run.json` | Captured stdout of that run |
| `parity/briefs/reports/u-completion-gate-v1-exit.txt` | Captured exit code (`2`) |

## Real run

```text
node parity/scripts/check-completion.mjs
# exit:2
```

Observed on this tree:

- exit code `2`
- `requirementCount` `74`
- `221` blockers
- `72` `REQUIREMENT_UNVERIFIED`
- open mismatch `MODE-PLAIN-ENTER-STICKY` (`BEHAVIOR_MISMATCH_OPEN`)
- also `SOURCE_LOCK_INCOMPLETE`, `ACCEPTANCE_DEFINITIONS_UNFROZEN`, `COVERAGE_DENOMINATOR_INCOMPLETE`, dependency and scenario gaps

## Tests

```text
bunx vitest run test/check-completion.test.mjs
# Test Files  1 passed (1)
# Tests  7 passed (7)
```

Covered behaviors:

- missing `requirements.json`
- open mismatch
- unverified requirement
- forged `verified-pass-paired` without paired Cursor+Pi evidence
- sealed fixture can PASS and fill §11 fields
- invalid args exit `1`
- live CLI against current tree exits `2` with BLOCKED

## Shape

`CompletionReport` is one JSON object with `verdict` `PASS` or `BLOCKED`, a `blockers` list, and the §11 identity fields. Checks are a fixed checklist (source lock, dependency graph, requirement coverage, scenario evidence, open mismatches). Any blocker forces BLOCKED and exit `2`. PASS requires empty blockers and writes the same fields with `verdict: PASS`.

Paired evidence is structural. `status: verified-pass-paired` without a `paired-run` entry that names both Cursor and Pi attempt IDs yields `REQUIREMENT_VERIFIED_WITHOUT_EVIDENCE`.

## Standing orders

Did not edit `parity/requirements.json`, `parity/mismatches.json`, or `parity/progress.md`. Did not shrink the denominator or close `MODE-PLAIN-ENTER-STICKY`.
