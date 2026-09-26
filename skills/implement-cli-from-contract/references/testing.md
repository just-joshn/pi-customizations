# Testing and verification

## Compatibility corpus layout

```text
.re/impl/<feature>/compat/
  cases/                 # authoring cases (yaml or json)
  fixtures/
  snapshots/
  normalizers/
  cases.json             # corpus for scripts/differential.py
  triage.json
  reference/<sha256>/<case-id>/
    meta.json
    stdout.raw
    stderr.raw
    fs-before.json
    fs-after.json
    trace.json
  differential/          # live reference vs candidate probe records
```

Each case describes the entire process boundary. Important reverse-engineered behavior must eventually map to a case. Optional fields include signals, TTY status, terminal width, locale, `NO_COLOR`, filesystem permissions, network fixtures, child processes, and timeouts.

Example authoring shape:

```yaml
id: config-cli-overrides-env
argv: [build, --config, fixtures/cli.toml]
env: { TOOL_CONFIG: fixtures/env.toml }
cwd: fixtures/project
stdin: null
expected:
  exit_code: 0
  stdout: { mode: exact, fixture: snapshots/config-cli-overrides-env.stdout }
  stderr: { mode: exact, fixture: snapshots/config-cli-overrides-env.stderr }
  filesystem: { created: [build/result.json] }
  network: { allowed: false }
```

`cases.json` for `scripts/differential.py`:

```json
{"id": "config-cli-overrides-env",
 "label": "CLI --config overrides TOOL_CONFIG",
 "args": ["build", "--config", "fixtures/cli.toml"],
 "probe": ["--isolate", "--clean-env", "--env", "TOOL_CONFIG=fixtures/env.toml",
           "--env", "NO_COLOR=1", "--seed", "fixtures/project:work"]}
```

Seed paths in `probe` resolve relative to `cases.json`. Commands run from the sandbox `work/` directory under `--isolate`, so give the candidate as an absolute path or a PATH entry. The `probe` options are those of `reverse-engineer-cli/scripts/probe.py`.

Capture reference results for the full safe corpus before coding. Store raw streams. Never store only normalized output.

## Compatibility policy

Write the policy before implementing. Example defaults:

| Behavior | Required comparison |
|---|---|
| Exit code | Exact |
| JSON / machine protocol | Exact schema and semantics (or structural when order is non-contractual) |
| Error destination | Exact stdout or stderr |
| Human help | Exact when compatibility requires it |
| ANSI styling | TTY-dependent contract |
| File contents | Exact or semantic per case |
| File permissions | Explicit when contractual |
| File paths | Semantic after temp-path normalization |
| HTTP request | Method, URL, relevant headers, body |
| Request IDs / timestamps / temp paths | Normalized when nondeterministic |
| Timing | Threshold, not exact |

A normalizer is valid only when the value is genuinely nondeterministic or explicitly outside the contract. Never normalize a deterministic difference because the candidate happens to differ.

The differential script compares exit code, signal, timeout, raw stdout and stderr bytes, and filesystem diff. It replaces each side's own sandbox root with `<SANDBOX>`. That is the one built-in normalization, because the two sides run in separate sandboxes by construction. Put additional justified normalizers in repository compatibility tests or under `compat/normalizers/`.

## Differential loop

```text
reference CLI + same argv/cwd/env/fixture/stdin → ReferenceResult
candidate CLI + same inputs → CandidateResult
normalize approved nondeterminism → structured diff
```

```sh
python3 scripts/differential.py run .re/impl/<feature>/compat/cases.json \
  --reference 'tool' --candidate '/abs/path/to/candidate' \
  --out .re/impl/<feature>/compat/differential

python3 scripts/differential.py compare \
  --out .re/impl/<feature>/compat/differential \
  --triage .re/impl/<feature>/compat/triage.json
```

Prefer a single project command such as `./compat/check` that verifies the reference hash, builds the candidate, creates isolated fixtures, runs every applicable case, normalizes approved nondeterminism, diffs, and exits nonzero on incompatibility. The comparison tool is part of the method.

`triage.json` maps a case id to an accepted standing difference:

```json
{"deprecated-flag": {
  "class": "INTENTIONAL_CHANGE",
  "reason": "Removed by feature specification XYZ"}}
```

Accepted triage classes for `compare`:

| Class | Meaning |
|---|---|
| `INTENTIONAL_CHANGE` | New requirement explicitly changes the contract (alias: `EXPECTED_DIFFERENCE`) |
| `NONDETERMINISM` | Justified normalizer needed, or reference differs from itself (alias: `REFERENCE_NONDETERMINISM`) |

Action classes that must not remain as untriaged success:

| Class | Action |
|---|---|
| `REGRESSION` | Fix the candidate |
| `REFERENCE_QUIRK` | Preserve the quirk; fix the candidate or isolate at the boundary |
| `BAD_TEST` | Fix the contract case |
| `VERSION_MISMATCH` | Align reference and expected version |
| `UNCLASSIFIED` / `MISSING` | Not done |

`compare` exits 1 while any difference is unclassified or a case is missing. Report exact totals, for example `CASES 127 MATCH 126 INTENTIONAL_CHANGE 1 UNCLASSIFIED 0 MISSING 0`.

## Three test layers

| Layer | Question | Examples |
|---|---|---|
| 1 Domain | Pure rules without launching a process | Config precedence, state transitions, format selection, request construction, error classification, path resolution |
| 2 Boundary | External representation ↔ internal types | Argument parsing, config parsing, serialization, rendering, exit-code mapping |
| 3 Real process | Built executable | Argv, cwd, env, stdin, stdout, stderr, exit status, filesystem, signals, TTY |

Compatibility-critical behavior belongs at layer 3. In-process runners (oclif helpers, Click/Typer `CliRunner`) are fine at layer 2. They do not replace process tests.

## Cases to write

- **Happy path and usage failures** from the public CLI examples written before design.
- **Config precedence** with unique values per layer, then remove winners from the top.
- **Errors with the same weight as successes.**
- **Hostile boundaries** justified by the feature: missing/empty/malformed input, permission denied, read-only directory, network unavailable, timeout, auth failure, missing dependency, broken pipe, SIGINT, repeated invocation, partial prior state, TTY vs pipe, Unicode and spaces in paths, different cwd, empty `HOME`, invalid env, malformed config.
- **Machine-readable output** as an API: field names, types, required/optional, null behavior, ordering when meaningful, error representation, versioning.
- **Snapshots** for `--help`, usage errors, multi-line diagnostics, JSON fixtures, generated files. Assert a single property directly when only that property matters. Never blindly regenerate snapshots.
- **Property / generated tests** for invariants reverse engineering stated but did not enumerate: irrelevant argument order, valid paths, config combinations, round trips, ranges, escaping, Unicode, repeated options.
- **Filesystem** existence, content, permissions, structure, symlink state.
- **Cross-platform** path separators, executable extensions, PATH resolution, shell invocation, permissions, symlinks, line endings, signals, temp dirs, Unicode paths, terminal capabilities when the CLI claims multi-OS support.

## Packaged artifact

Do not finish verification against `ts-node`, `python source.py`, `cargo test` helpers, or framework command runners unless that is how users run the product.

Build or package, then execute the artifact users receive:

- TypeScript: pack/install the npm artifact
- Python: build wheel, install into a clean environment, invoke the console script
- Rust: build the release binary and test that artifact

Install verification covers PATH appearance, launcher target, `--version`, `--help`, packaged resources, configuration discovery, shell completion when supported, and runtime dependencies.

## Feature interaction and continuous runs

After every meaningful step, run the relevant subset: feature unit tests, feature compatibility cases, command-group tests, then the full suite. Also run existing commands that share global arguments, config, authentication, filesystem state, network clients, logging, formatting, or exit handling.

## Full proof sequence

Before declaring complete:

1. Clean checkout or clean worktree.
2. Install dependencies from the lockfile.
3. Run static checks.
4. Run unit tests.
5. Run boundary tests.
6. Build/package the CLI.
7. Install or stage the built artifact.
8. Run process-level tests against the built artifact.
9. Run the reference/candidate differential suite.
10. Run feature-interaction regression cases.
11. Run supported-platform CI where available.
12. Inspect the diff.
13. Re-run the critical user scenario manually or through an end-to-end script.
14. Save the final comparison report.

Compilation is step 6, not proof of completion.

## Compatibility report

```json
{
  "reference": {"version": "4.2.1", "sha256": "..."},
  "candidate": {"commit": "...", "artifact_sha256": "..."},
  "cases": {"total": 87, "passed": 87, "failed": 0},
  "intentional_differences": [
    {"case": "deprecated-flag",
     "reference": "accepted",
     "candidate": "rejected",
     "reason": "Removed by feature specification XYZ"}
  ]
}
```

Never hide intentional differences through normalization.

## Agent decision tree

```text
START
 |-- Read reverse-engineering evidence
 |-- Required behavior uncertain? → probe reference → update evidence
 |-- Encode compatibility cases
 |-- Capture immutable reference results
 |-- Inspect target architecture and blast radius
 |-- Write desired public usage
 |-- Separate public behavior from implementation accidents
 |-- Design types and ownership (two shapes when ownership is unclear)
 |-- Implement one vertical slice
 |-- Run candidate against reference
 |-- Mismatch? → classify → fix / probe / update contract / justify normalizer
 |-- Expand implementation
 |-- Add hostile-boundary cases
 |-- Build/package real artifact
 |-- Run full process suite, differential suite, blast-radius regressions
 |-- Inspect diff → produce compatibility report
END
```

## Per-language stack

Use the framework the repository already has.

- **TypeScript.** Vitest or Jest for units. Spawn the built bin for integration. Execa for typed process control. Vitest snapshots for committed CLI output.
- **Python.** pytest with `tmp_path` and `monkeypatch`. `CliRunner` for thin command tests. `subprocess` for boundary cases. `uv` for install verification.
- **Rust.** `cargo test` for logic. `assert_cmd` / `assert_fs` for process cases. `trycmd` or `snapbox` when a large corpus benefits.
