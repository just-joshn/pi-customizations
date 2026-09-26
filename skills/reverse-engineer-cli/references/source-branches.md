# Source and language branches

## Trace ownership from the established entry point

Record entrypoints in `source/entrypoints.json`, selected symbols as JSONL in `source/symbols.jsonl`, and the flow in `source/flow.md`. Every source reference includes artifact/revision, path, symbol, and line range where useful. Lines alone become stale.

Follow parser → configuration → dispatch → operation → adapters → output/error/exit selection. At each boundary identify inputs, validation, transformation, state, effects, and ownership. Stop when the requested behavior is explained. Repository-wide searches are a fallback after entry-point tracing, not the starting point.

Use `rg` for literals. Use ast-grep structural patterns, Tree-sitter queries, or Universal Ctags JSON when the construct is known. Check the installed tool's help/current official documentation before choosing syntax. Do not invent subcommands. Search command/option registration, handlers, env reads, file operations, HTTP clients, process creation, serialization, error conversion, and exits. Keep symbol extraction scoped.

## TypeScript and JavaScript

Inspect the installed package's `package.json` first. Record `bin`, `main`, `exports`, `imports`, `type`, dependencies, optional/peer dependencies, engines, and scripts. Resolve `bin` to the actual parser and registration code. Inspect tsconfig, lockfile, build/bundler config, and source-map settings. Parser calls such as command, option, action, parse, parseAsync, handler, run, execute, and main are discovery leads only.

Distinguish compiled JS, bundles, minification, ncc/esbuild output, standalone Node/Bun executables, and native wrappers. Search `sourceMappingURL` and `.map` files before reading minified code. Preserve map hashes, original member names, and `sourcesContent`; reconstruct only into a separate recovery directory. Resolve names safely, rejecting absolute paths and traversal. Do not fetch map URLs automatically. Maps may be stale or incomplete; correlate them to the shipped bundle.

For runtime questions, launch the identified JS entry under the matching Node runtime with inspector support bound to loopback. Preserve wrapper arguments and environment. Target one handler, config object, path transformation, request construction, or exception conversion. Record differences between this invocation and the shipped launcher; inspector behavior alone does not establish release behavior.

## Python

Resolve the wrapper's interpreter and environment first. Use that interpreter's `importlib.metadata.entry_points(group="console_scripts", name="tool")` where supported to inspect module/callable/distribution metadata. Do not call `EntryPoint.load()` just to identify the entry. Inspect distribution files, `METADATA`, `RECORD`, `entry_points.txt`, and `direct_url.json`. Entry point availability and API shape depend on interpreter version. Installed `.py` source is stronger evidence for an installed CLI than an unmatched checkout.

Classify normal `.py`, `.pyc` only, zipapp, PEX/Shiv archive, PyInstaller, Nuitka/native, or embedded Python. Inspect archive listings before extraction or decompilation. Preserve paths safely in a dedicated recovery directory. PyInstaller one-file runtime extraction can be observed through a controlled temp directory; do not assume every bundle uses that mode.

Trace the console entry → parser → handler → application → adapters. Use the interpreter's `trace` module for executed functions or caller/callee information before line tracing. Resolve a runnable script/module; a console entry specification is not itself a script filename. Check that tracing preserves launcher semantics.

For bytecode, identify magic number and exact CPython version, then use compatible `dis` tooling. The `python -m dis` interface does not imply it can directly consume every `.pyc` container. Preserve headers, distinguish container parsing from code-object disassembly, and do not load untrusted marshal data on the host. Treat guessed reconstructed source as inference. For Nuitka or unrecoverable bundled code, use native analysis.

## Rust

After installed-command identity, use Cargo to map the repository. Inspect Cargo.toml, Cargo.lock, workspace members, `[[bin]]`, `src/main.rs`, `src/bin/`, build.rs, features, toolchain and target config. Capture `cargo metadata --format-version 1` and `cargo tree` in an isolated checkout with locked/offline options when appropriate. If resolution needs network or lockfile changes, record that requirement rather than silently altering evidence. A no-deps result is an incomplete dependency graph.

Record selected binary/package, target triple, feature flags, workspace/default members, direct/build/platform dependencies, and matching build invocation. Default Cargo output does not prove release feature selection. Trace main → parser structs/enums → dispatch → handler → operation → adapters → output/errors. Inspect parser declarations rather than only help strings.

Build a matching revision in isolation when feasible. Compare its observable behavior with the installed release before using a debug build to explain release internals. Record compiler, optimization, LTO, panic strategy, linking, and features. Byte equality is not required.

For installed-only native targets, collect architecture, stripped/debug state, libraries, build ID, paths, symbols, panic strings, and crate/version leads. Demangle retained Rust names with rustfilt. Treat embedded crate versions and strings as leads until correlated. Monomorphization, inlining, LTO, and stripping can erase apparent source boundaries.

## Algorithms and history

For an important transformation, identify input/output domains, ordering, state, invariants, limits, and errors. Construct minimal fixtures that distinguish candidate algorithms. Check ties, empty inputs, numeric boundaries, Unicode, stability, and deterministic ordering where relevant. Measure complexity only when it matters to compatibility and distinguish measurements from asymptotic claims.

Use blame/history after current behavior is understood to explain intent. Commit messages can support historical rationale; they do not establish current runtime behavior.
