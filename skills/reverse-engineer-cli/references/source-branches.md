# Source topology and language branches

Start this only after the black-box contract from `probing.md` is captured.

## Phase G: topology

Record repository state and change nothing:

```bash
git status --short
git rev-parse HEAD
git branch --show-current
git log -1 --format=fuller
```

Read structural files first: README, package manifest, lockfile, workspace config, build system, CLI entrypoint, tests, and config schema. Use `rg` for text and ast-grep for syntax-aware structure. Prefer structural queries over giant regular expressions.

```bash
ast-grep outline src --items exports --json=compact
ast-grep outline src --items imports --json=compact
```

Use structural search to find where commands are registered, subprocesses spawned, files opened, environment variables read, HTTP clients constructed, configuration merged, and exit codes chosen.

## TypeScript / JavaScript

Read `package.json` (`bin`, `exports`, `scripts`), the lockfile, `tsconfig.json`, bundler config, source maps, and which CLI framework it uses. The `bin` field maps installed command names to executable files, so check it early for npm-installed CLIs.

Map: bin entry → argument parser → command handlers → domain/service layer → I/O adapters.

Work out whether the installed command runs plain JS, transpiled TypeScript, bundled JS, a Node executable wrapper, Bun or Deno output, or a native packaged binary. Preserve source maps.

For runtime debugging, use the V8 inspector bound to localhost. `--inspect-brk` stops at startup, and `--inspect-wait` waits for a debugger to attach.

```bash
node --inspect-brk path/to/entry.js ...
```

Enable only the Node tracing flags the current question needs.

## Python

Read `pyproject.toml`, `setup.cfg` or `setup.py`, `src/`, the package modules, tests, and entry points (`[project.scripts]` / `console_scripts` map the executable to an importable object).

For an installed distribution, read `*.dist-info/METADATA`, `RECORD` (which enumerates installed files), `entry_points.txt`, and `direct_url.json`. Prefer `importlib.metadata` over guessing from the filesystem.

Map: console entry point → `main()` or app object → argument framework → command handler → domain logic.

Source beats bytecode. Use `dis` (API or `python -m dis`) only when source is missing or generated behavior stays unclear. Bytecode changes between CPython releases, so record the exact interpreter version whenever bytecode is evidence.

## Rust

```bash
cargo metadata --format-version 1   # workspace members, targets, resolved deps
cargo tree                          # dependency graph and enabled features
```

Binary targets come from `src/main.rs`, `src/bin/*`, and `[[bin]]`.

Map: `main` → CLI parser → command enum/dispatch → application/domain functions → filesystem/network/process adapters.

When lower-level behavior stays unclear, build an isolated diagnostic build and emit IR or assembly for the specific question only:

```bash
cargo rustc --bin <target> -- --emit=llvm-ir,asm
```

A local release build will rarely match a distributed binary byte for byte. Compiler version, target features, linker, LTO, stripping, and build environment all differ. Aim for behavioral equivalence.

## Phase T: repository history

Once current behavior is known, use history to explain intent: why a branch exists, when a flag appeared, whether a behavior was a bug fix, and what older interface it replaced.

```bash
git log -- <path>
git blame <path>
git log -S'<identifier>'
git log -G'<pattern>'
```

Commit messages are `HIST` evidence of intent. They do not prove current runtime behavior.
