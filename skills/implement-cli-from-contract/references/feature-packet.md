# Feature packet, evidence map, and completion

## Packet layout

```text
.re/impl/<feature>/
  mode.md            implementation mode and scope record
  policy.md          compatibility comparison policy
  contract.md        public usage and behavior classes
  evidence-map.md    behavior → case → owner → test → RE probe
  notes.md           design choice, baseline, deliberate new behavior
  report.json        final machine-readable compatibility report
  compat/
    cases.json
    triage.json
    cases/ fixtures/ snapshots/ normalizers/
    reference/<sha256>/...
    differential/
```

Permanent regression tests live in the repository's own suite. The packet holds evidence and working state. Keep temporary dual runners and extraction tools under `compat/`, `scripts/`, `tests/`, or `tools/`, not in the shipped CLI.

## mode.md

```text
implementation mode: B Reimplement
target repository: /absolute/path/to/repo
reference executable: /absolute/path/to/tool
reference version/hash: 4.2.1 / sha256:...
target version/commit: main @ abcdef0
features in scope: inspect (human + --json)
features out of scope: plugin loading
compatibility requirements: exit codes, JSON schema, config precedence CLAIM-012
```

## contract.md

Write public usage first:

```console
tool inspect package.tar
tool inspect package.tar --json
tool inspect package.tar --format summary
tool inspect - < package.tar
```

Then failures:

```console
tool inspect
tool inspect missing.tar
tool inspect package.tar --format invalid
```

For each invocation record parsed meaning, stdout, stderr, exit code, and side effects.

```text
Feature: inspect
Invocation: tool inspect <archive> [--json] [--format summary]
Inputs: archive path or stdin
Config dependencies: none
Output: human summary on stdout, or JSON object on stdout with --json
Errors: missing archive → stderr, exit 2
Side effects: none
Behaviors:
  OBSERVED preserve  missing archive exits 2                 OBS-034
  PROVEN   preserve  --json schema fields path,size,ok       OBS-040
  INFERRED probe     Unicode normalization of paths          U-7
  accident ignore    reference internal cache keyed by inode SRC-091
Evidence: OBS-031, OBS-034, OBS-040, SRC-082
```

## evidence-map.md

```text
Behavior: CLI --config overrides TOOL_CONFIG
compat: config-cli-overrides-env
implementation: config/resolve.*
unit test: resolve_config_cli_wins
process test: config_precedence_cli
reference evidence: RE-PROBE-041
```

## Baseline notes

Before editing, record commit, `git status --short`, runtime and compiler versions, lockfile state, and results of existing build, test, lint, typecheck, and format commands. Record pre-existing failures separately.

## Completion report

```text
IMPLEMENTED
  commands: …

CONTRACT
  arguments, configuration, exit codes: summary with evidence IDs

ARCHITECTURE
  cli adapter → … → presentation

BASELINE
  pre-existing failures: …

VERIFIED
  unit tests: N passed
  boundary tests: N passed
  process tests: N passed
  differential: CASES N  MATCH N  INTENTIONAL_CHANGE N  UNCLASSIFIED 0  MISSING 0
  lint / typecheck / build: passed
  packaged executable: exercised via <command>
  blast-radius regressions: …

INTENTIONAL DIFFERENCES
  id: reason, evidence

NEW BEHAVIOR (was UNKNOWN / INFERRED)
  behavior: choice and why it is reversible

UNRESOLVED
  none, or each item with its impact
```

## Completion criteria

Do not declare complete because the code builds, unit tests pass, the happy path works, output looks similar, or the new design seems cleaner.

Declare complete only when:

- The required observable contract is encoded.
- The feature has one clear internal owner.
- External data is parsed at boundaries.
- Invalid states are difficult or impossible to represent.
- The implementation does not depend unnecessarily on the CLI framework.
- Configuration precedence matches the required behavior.
- Errors map explicitly to output and exit statuses.
- External effects are isolated.
- The built artifact passes its real process tests.
- The candidate passes the required differential cases.
- Blast-radius regressions have been exercised.
- Intentional behavior changes are documented explicitly.
- A second agent can reproduce the verification without trusting the first agent's explanation.

## Rules the implementation agent must not violate

1. Do not use reverse-engineered source structure as the default architecture.
2. Do not begin implementation before capturing the reference behavior that matters.
3. Do not change expected output merely because the candidate differs.
4. Do not normalize deterministic differences.
5. Do not pass raw parser objects into domain logic.
6. Do not read configuration independently from several feature modules.
7. Do not let arbitrary exceptions choose exit codes.
8. Do not print directly from business logic when output compatibility matters.
9. Do not mock an executable when the real executable can be run safely.
10. Do not accept unit tests as proof of CLI compatibility.
11. Do not test only the source runner when users receive a packaged artifact.
12. Do not preserve obsolete internal APIs only because migration is inconvenient.
13. Do not duplicate old and new implementations indefinitely.
14. Do not add a compatibility workaround deep inside the domain when it can live at the boundary.
15. Do not treat help output as the complete CLI specification.
16. Do not silently alter stdout versus stderr routing.
17. Do not silently change exit codes.
18. Do not silently change machine-readable output.
19. Do not implement an `INFERRED` behavior without resolving it when correctness depends on it.
20. Do not declare success until the real feature path has been exercised through the built artifact.

## Stop rules

- Stop probing when no implementation decision depends on the unknown.
- Stop abstracting when the architecture expresses the known requirements clearly.
- Stop optimizing when the measured requirement is met. Measure against the reference before optimizing, and only when performance is part of the contract.
- Stop debugging when the original reproducer, its regression test, and the surrounding suite all pass.
