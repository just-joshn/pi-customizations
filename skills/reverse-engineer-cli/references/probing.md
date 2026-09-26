# Identity and behavioral experiments

## Evidence workspace

Use a dedicated `.re/` outside the target repository when practical. Never reuse a workspace for a different artifact identity.

```text
.re/
  target/ identity.json hashes.txt
  raw/ help/ versions/ metadata/
  probes/ cases.json results.jsonl
  source/ symbols.jsonl entrypoints.json flow.md command-tree.json
  traces/ process/ filesystem/ network/ runtime/
  binary/ metadata/ strings/ functions/ decompiler/
  hypotheses/ open.md resolved.md
  repro/ fixtures/ scripts/ run-all
  report/ behavior.md architecture.md evidence.md
```

Raw evidence belongs to immutable run directories. Summaries and ledgers reference those files, never replace them.

## Resolve what runs

For an installed command, inspect shell resolution in the operator's actual shell:

```sh
type -a tool
command -v tool
```

Resolve symlinks with `realpath` where available. Inspect `file` output on the resolved path, and read its first 20 lines only if it is text. `command -v` may describe a function or alias rather than a file. A subprocess argv array does not reproduce shell aliases/functions: record and recreate their expansion explicitly.

On Windows, use `Get-Command -All`, resolved file properties, and `Get-FileHash -Algorithm SHA256`. Follow `.cmd`, PowerShell, package-manager shims, and native launchers.

Record the complete chain:

```text
user command → PATH entry → wrappers/symlinks → runtime → package entry → application entry
```

Classify shell wrapper, Node script, Python console script, native ELF/Mach-O/PE, standalone Node/Bun executable, Python archive, PyInstaller/Nuitka, Rust, or unknown. A native executable does not prove Rust implementation.

`target/identity.json` must contain target and resolved paths, SHA-256, size, platform, architecture, reported version with evidence, repository commit/dirty state, runtime version, package-manager metadata, and UTC analysis timestamp. Distinguish host architecture from target architecture. The initializer leaves unavailable values null for the investigator to resolve or mark unavailable with a reason. Record all identity-bearing files in the artifact list and `hashes.txt`.

Collect supported version commands through the probe runner. Inspect `package.json`, `pyproject.toml`, `Cargo.toml`, lockfiles, version constants, release metadata, and tags. Capture `git rev-parse HEAD`, `git status --porcelain`, and `git describe --tags --always`. Record source changes, submodules, build flags, runtime/compiler versions and selected features when they affect a build. Never execute a package installation hook or build script merely to read metadata.

## Public command tree

Capture supported `--help`, `-h`, and version forms; nested help; unknown options; and missing required arguments. Run bare invocation only after evaluating its effects. Record every stream and status.

Each command-tree node contains `command`, `arguments`, `options`, `subcommands`, and `evidence`. Each option includes long/short spelling, type, requirement, default, repeatability, environment/config counterpart, conflicts, dependencies, possible values, and evidence. Use null for unknown fields, not an invented default. Include aliases, hidden commands discovered in source/completions, and whether each item is advertised, source-declared, or actually observed.

## Behavioral matrix

Every case answers a question. Select relevant dimensions and record why others do not apply.

| Area | Cases |
|---|---|
| Grammar | No arguments, valid/invalid/missing arguments, unknown/repeated options, order, `--`, aliases |
| Input | stdin, file, empty/binary/malformed input, missing final newline, large bounded input |
| Paths | Relative/absolute, spaces, Unicode, missing file, directory instead of file, permissions |
| Configuration | Empty/malformed files, discovery locations, env, defaults, explicit config, merge rules |
| Environment | cwd, clean/inherited env, PATH, locale, timezone, NO_COLOR, CI, terminal size |
| Streams | stdin/stdout/stderr TTY independently, pipe, raw bytes, ANSI, newline, JSON, closed stdin |
| Lifecycle | Interrupt/termination, timeout, broken pipe, cleanup, child failure, unavailable dependencies |
| External systems | Offline behavior, controlled endpoint, retry/timeout, cache present/absent, unavailable network |

Use fresh fixture directories and isolated HOME/XDG/TMP paths. Explicitly control PATH, LANG, LC_ALL, TERM, NO_COLOR, CI, COLUMNS, and LINES when relevant. Set these only in the child environment. Record interpreter resolution changes caused by a modified PATH. Test permission errors as an ordinary user; root bypasses many permission checks.

Snapshots identify final changes, not reads or files created and deleted between snapshots. Use traces for those questions. `network_observed: null` means unmeasured, not offline. An empty network trace proves nothing without adequate process/child and syscall coverage.

For broken-pipe behavior, build a consumer that deliberately closes its pipe and record the target process's status separately. A shell pipeline's status may describe only its final command.

## Configuration precedence

Give every layer a distinct valid sentinel: default, system, user, project, environment, CLI. Probe each layer independently, then conflicting pairs and combined layers. Remove the winner and repeat. Include explicit config-file selection, field-level deep/shallow merges, lists, null/empty values, discovery from nested cwd, and malformed losing layers. A losing value can still be read or validated.

Write the question, controlled inputs, observation, and conclusion. Example: setting env to `env-value` and the flag to `cli-value` selects `cli-value` in P-014. This establishes precedence for that field and case, not every field.

Do not instrument before recording a baseline. Instrumentation may change timing, buffering, environment, or control flow; replay uninstrumented cases to check the relevant conclusion.
