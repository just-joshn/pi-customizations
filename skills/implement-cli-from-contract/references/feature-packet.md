# Feature packet and completion report

## Packet layout

```text
re/90_impl/<feature>/
├── contract.md      the feature contract below
├── cases.json       differential cases (see testing.md)
├── triage.json      explained differences only
├── differential/    probe records written by scripts/differential.py
└── notes.md         design choice, baseline results, deliberate new behavior
```

Permanent regression tests go in the repository's own test suite. The packet holds only evidence and working state.

## contract.md

```text
Feature: config get
Invocation: tool config get <key>
Inputs: key: string
Config dependencies: user config, project config (precedence: CLAIM-012)
Output: resolved value + "\n" on stdout
Errors: missing key → stderr "error: …", exit 2
Side effects: none
Behaviors:
  A  missing key exits 2                       OBS-034
  A  project config overrides user config      CLAIM-012
  B  error message punctuation                 OBS-035
  D  Unicode normalization of keys             unknowns.md#U-7 → probe P-…, or new behavior
Evidence: OBS-031, OBS-034, SRC-082
```

## Completion report

```text
IMPLEMENTED
  commands: config get, config set

CONTRACT
  arguments, configuration, exit codes: summary with evidence IDs

ARCHITECTURE
  cli adapter → config resolver → domain operation → filesystem adapter

BASELINE
  pre-existing failures: …

VERIFIED
  unit tests: N passed
  CLI tests: N passed
  differential: CASES N  MATCH N  EXPECTED_DIFFERENCE N  UNCLASSIFIED 0  MISSING 0
  lint / typecheck / build: passed
  packaged executable: exercised via <command>

EXPECTED DIFFERENCES
  id: reason, evidence

NEW BEHAVIOR (was UNKNOWN)
  behavior: choice and why it is reversible

UNRESOLVED
  none, or each item with its impact
```
