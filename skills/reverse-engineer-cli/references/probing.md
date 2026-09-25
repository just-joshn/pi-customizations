# Identity, surface, and black-box probing

Capture behavior before reading implementation, so source does not bias what you look for. Save every output under `re/10_identity/` or `re/20_surface/`, and run the probes through `scripts/probe.py`.

## Phase A: target identity

```bash
command -v <cli>; type -a <cli>
realpath "$(command -v <cli>)"
file "$(command -v <cli>)"
head -n 1 "$(command -v <cli>)"
sha256sum <binary>        # macOS: shasum -a 256 <binary>
```

Windows (PowerShell): `Get-Command <cli> | Format-List *` and `Get-FileHash <path> -Algorithm SHA256`.

Record the resolved PATH entry, symlink chain, file type, architecture, executable format, hash, version output, modification time, and code signature if it matters. Try `<cli> --version`, `-V`, and `version`, and keep only the forms the CLI accepts.

When source also exists, collect the installed version, repository version, commit or build ID, package version, release tag, and build metadata. Label the relationship `MATCHED`, `LIKELY_MATCHED`, `MISMATCHED`, or `UNKNOWN`.

## Phase B: classify the launcher

Decide what the PATH executable actually is: a shell wrapper, a Node.js launcher, a Python console-script wrapper, native ELF, Mach-O, or PE, a bundled JavaScript or Python executable, or a launcher for another executable. Decide from the shebang, symlink target, imports, embedded runtime strings, neighboring package files, and loaded runtime libraries. The answer picks the branch in `source-branches.md` or `tracing-and-binary.md`.

## Phase C: public contract

Run `<cli>`, `--help`, `-h`, `help`, and `--version`, keeping stdout, stderr, and exit code separate. Recurse into every discovered subcommand (`cli foo --help`, `cli foo bar --help`, and so on). Also read man pages, README examples, packaged docs and examples, and shell completion scripts or generated completions. Completions often reveal hidden aliases, option values, nested subcommands, enumerations, and dynamic completion.

Write the command tree to `re/70_model/cli-contract.json`:

```json
{"name": "tool", "options": [], "subcommands": [{"name": "build", "arguments": [], "options": []}]}
```

## Phase D: harness conventions

Compare the raw bytes `scripts/probe.py` saves, not decoded text.

Normalize nondeterministic data (timestamps, temporary paths, PIDs, random IDs, absolute machine paths, assigned ports) only after repeated runs show it varies, and record each normalization rule next to the evidence for it.

## Phase E: behavioral matrix

Vary one dimension at a time per significant command.

**Inputs.** No arguments, the minimum valid invocation, a typical valid invocation, empty strings, whitespace, relative and absolute paths, nonexistent paths, a directory where a file is expected and the reverse, Unicode, very long values, duplicate flags, reordered independent flags, an unknown flag, an unknown subcommand, a missing required argument, and an extra positional argument.

**stdin.** Empty (`--stdin-mode null`), small text, multi-line, a missing final newline, large input, binary bytes, closed (`--stdin-mode closed`), TTY (`--stdin-mode tty`), and pipe.

**Output.** Record stdout and stderr separately, including ANSI escapes, progress output, TTY formatting (`--tty stdout|stderr|both`), line endings, the trailing newline, JSON formatting, and ordering.

**Environment.** Start from `--clean-env` and add one variable at a time. Candidates are `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `TMPDIR`, `TEMP`, `PATH`, `NO_COLOR`, `CI`, `TERM`, `LANG`, `LC_ALL`, `TZ`, `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`. A variable matters only after a probe shows that it does.

**Working directory.** Run identical commands from the repository root, a nested directory, an empty temp directory, home, a directory containing config, and one without config (`--cwd`, or `--seed` into the sandbox).

**Lifecycle.** SIGINT (`--send-signal INT`), SIGTERM where appropriate, broken pipe (`-- sh -c 'tool … | head -c1'`), child-process failure, timeout (`--timeout`), partial output, and cleanup after failure. A record with `descendants_hold_output: true` means the CLI left descendants running with its output streams open.

## Phase F: filesystem effects

Use `--isolate` (plus `--snapshot DIR` for anything outside the sandbox) so every significant probe starts from a fresh HOME, config, cache, temp, and working directory. Read the diff for created, modified, and deleted files, permissions, symlinks, temp files, lock files, cache entries, and database files. Reads leave no diff, so confirm them with a trace (`tracing-and-binary.md`). A filesystem diff often reveals the configuration model faster than reading source does.

## Phase R: configuration precedence

Precedence usually matters more than syntax. Put a conflicting, uniquely marked value in each layer: built-in default (`default-A`), global config (`global-B`), user config (`user-C`), project config (`project-D`), environment variable (`env-E`), and CLI option (`cli-F`). Seed the files into the sandbox with `--seed`. Run the command and see which marker wins. Remove the winning layer and repeat until the full order is derived. Only then check it against source, and write the result to `re/70_model/config-precedence.md`.
