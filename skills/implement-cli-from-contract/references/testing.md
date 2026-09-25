# Testing and verification

## Levels

| Level | Runs | Covers |
|---|---|---|
| 1 Pure logic | Direct calls | Config merge, domain decisions, internal formats, state transitions |
| 2 Adapters | Adapter with a temp directory or fake peer | Filesystem, process wrapper, HTTP wrapper, renderers |
| 3 CLI integration | The built candidate executable | Argv, stdin, stdout, stderr, exit status, files |
| 4 Differential | Reference and candidate under the same controlled environment | Everything class A |

A feature is verified only when its relevant level 4 cases pass. In-process runners (oclif test helpers, Click and Typer `CliRunner`) are fine at level 2. They do not reproduce signals, environment inheritance, cwd, encoding, TTYs, or entrypoint packaging, so compatibility-critical cases spawn the real process.

## Differential runs

A case in `cases.json` for `scripts/differential.py`:

```json
{"id": "config-get-missing", "label": "OBS-034 missing key exits 2",
 "args": ["config", "get", "nope"],
 "probe": ["--isolate", "--clean-env", "--env", "NO_COLOR=1", "--seed", "fixtures/proj:work"]}
```

The `probe` options are those of `reverse-engineer-cli/scripts/probe.py`: isolation, seeds, env, stdin, `--tty`, `--send-signal`, `--snapshot`, `--timeout`. The script compares exit code, signal, timeout, raw stdout and stderr bytes, and the filesystem diff. It replaces each side's own sandbox root with `<SANDBOX>`. That is the one normalization built in, because the two sides run in separate sandboxes by construction.

Classify every difference, then act on the class:

| Class | Meaning | Action |
|---|---|---|
| MATCH | Identical | Nothing |
| EXPECTED_DIFFERENCE | A deliberate, recorded divergence | Add it to `triage.json` with the reason and the evidence ID |
| REFERENCE_NONDETERMINISM | The reference differs from itself across runs | Prove it by running the reference repeatedly, then add it to `triage.json` or write a semantic comparator |
| CANDIDATE_BUG | The candidate is wrong | Fix the root cause in the smallest coherent layer, never in `triage.json` |
| UNKNOWN | Not yet explained | Write a smaller discriminating probe. It is not success |

`compare` labels untriaged differences `UNCLASSIFIED`. Report the final totals exactly, for example `CASES 127 MATCH 126 EXPECTED_DIFFERENCE 1 UNCLASSIFIED 0 MISSING 0`, and never as a percentage.

## Semantic comparators

Byte identity is the default. A looser comparison needs a stated reason why the field is non-contractual:

- Parse and compare JSON structurally when field order is not contractual.
- Normalize a known per-test temp root.
- Check the shape or range of timestamps and generated IDs.

Write these as assertions in the repository's own compatibility tests. Never normalize a difference just because it is inconvenient.

## Cases to write

- **Raw bytes.** Capture stdout and stderr before decoding. This catches UTF-8 problems, invalid bytes, newline style, a missing trailing newline, ANSI codes, and control sequences.
- **Stream split.** Assert stdout and stderr separately. With oclif under Vitest, disable console interception so the capture works.
- **Config precedence.** Give each source a unique value (default A, user B, project C, env D, CLI E) and assert E. Then remove sources one at a time from the top and assert each next winner. Pin the whole order, not just one happy path.
- **Errors, with the same weight as successes.** Cover invalid input, a missing file, permission denied, malformed config, a missing dependency, a child exiting nonzero, a network timeout, an invalid response, a partial write, and cancellation.
- **Boundaries.** Test around each threshold (-1, 0, 1, max, max+1). For paths, test empty, relative, absolute, nonexistent, a directory, a file, a symlink, Unicode, and spaces. For input, test empty, newline-only, no final newline, large, and invalid encoding.
- **Metamorphic.** `--quiet` leaves generated files unchanged. An absolute path gives the same target from any cwd. JSON mode and human mode encode the same result. Reordering independent flags changes nothing.
- **Property-based,** for large input spaces only. Use fast-check, Hypothesis, or proptest. Good properties include "never crashes on valid Unicode", serialization round trips, idempotent path normalization, and "merge keeps higher-precedence values". Minimize every counterexample, reproduce it against the reference, and add it to `cases.json`.
- **Filesystem.** Check existence, content, permissions, structure, and symlink state. Don't compare inodes or mtimes unless they are contractual.
- **Golden fixtures,** for stable contractual output only: help, version, structured diagnostics, reports, JSON, completions, generated config. Update fixtures explicitly, and never auto-accept snapshots in CI.
- **Help and completions.** Cover root and subcommand help, option order, how defaults are shown, aliases, required markers, examples, and version. For completions, check that the key commands, flags, aliases, and enum values appear.
- **TTY and interactive behavior.** Use `--tty` probes and PTY tests for prompts, colors, and progress. On a pty, `\r\n` line endings come from the terminal, not the CLI.
- **Signals.** Use `--send-signal INT --after N` to check cleanup, child signaling, exit status, and leftover state.

## Per-language stack

Use the framework the repository already has.

- **TypeScript.** Vitest or Jest for units. Spawn the built bin for integration. Vitest can target a single file or line for tight loops.
- **Python.** pytest with `tmp_path` and `monkeypatch`. `CliRunner` for thin command tests, `subprocess` for boundary cases.
- **Rust.** `cargo test` for logic. `assert_cmd` for args, cwd, env, stdin, timeout, exit status, stdout, and stderr. Adopt `trycmd` or `snapbox` only if they make a large case corpus simpler.

## Verification matrix

Build this before claiming completion. Mark only what you actually ran.

| Behavior | Evidence | Unit | Integration | Differential |
|---|---|---:|---:|---:|
| valid invocation | OBS-001 | ✓ | ✓ | ✓ |
| missing argument | OBS-002 | n/a | ✓ | ✓ |

## Adversarial review

Run each relevant case below against both executables and add any surprise to `cases.json`:

- no arguments, and every required value missing
- malformed config, `HOME` missing, an empty environment, an empty cwd
- stdout piped, stderr piped, the destination already existing
- the child executable absent, network access failing, Ctrl-C mid-operation
- Unicode, spaces in paths, huge inputs
