# Architecture for a contract-driven CLI feature

This is a logical architecture. Collapse any layer that provides no useful boundary.

```text
CLI adapter (argv, env, stdin, TTY)
  → typed request
  → config resolution (defaults, files, env, CLI)
  → domain / use case (validation and decisions)
  → filesystem, process, network adapters
  → typed result or semantic error
  → presentation (human, JSON, stderr, exit code)
```

## Choose the shape

- **A. The command owns everything.** Simple at first, but it degrades once the behavior grows.
- **B. A thin command plus a domain operation.** Parse, then build a typed request, run the operation, get a typed result, and render it. This is the default.
- **C. B plus ports for the filesystem, processes, network, clock, and env.** Escalate to C only when several side effects, heavy testing, determinism, or reuse across frontends demand it.

Commands share domain operations. A command never invokes another command, unless the contract shows it spawning one.

## Domain types

Define the request, the result, and the errors before the parser. Example:

```text
ResolveConfigRequest { key, explicit_config_path?, cwd }
ResolveConfigResult  = Found { value, source } | Missing
```

- Give states that behave differently their own variants. Use `NotConfigured | Configured(value) | InvalidConfig(reason)`, not `string | null`.
- Use an enum for output mode when more modes are possible or behavior diverges, instead of a boolean such as `is_json`.
- Keep provenance (`Resolved<T> { value, source }`) when the source affects diagnostics or later behavior.

## Parsing boundary

The parser owns syntax, types, required and optional distinctions, aliases, enumerations, conflicts, and defaults that belong purely to syntax. Domain policy stays out of parser callbacks. Convert parser output to domain types immediately.

Parse a default as absent (`Option<T>`, `T | undefined`, `None`) when config can override it. The resolver can then tell "not specified" apart from "explicitly the default value". Precedence depends on that distinction.

Generate help and completions from the command definitions. Don't hand-maintain a second command tree.

## Configuration

Load each source separately, then merge them once in the precedence order the evidence established:

```text
merge(Defaults, Global, User, Project, Environment, Cli)
```

Do not read config or env lazily from scattered call sites. Pass controlled environments to tests.

## Side effects

- **Pure core.** Turn inputs into a plan, such as `DownloadPlan { url, destination, overwrite_policy }`. A narrow adapter executes the plan.
- **Filesystem.** Centralize path resolution, creation, overwrite, permissions, symlinks, temp files, and cleanup. If the reference writes atomically (temp file, then optional fsync, then rename), keep that, because failure behavior differs from a direct overwrite. For multi-step mutations, validate first, prepare, commit, and clean up. Reproduce partial mutation only when the contract exposes it.
- **Child processes.** Use one interface, `ProcessRequest { executable, args, cwd, env, stdin_mode }`. Execute with an argv array (`spawn`/`execFile`, `subprocess.run([...])`, `Command::new`), never a shell string, unless the contract needs shell semantics. Preserve the observed stream semantics: inherited versus captured output, live versus buffered, stdin forwarding, detach, and signal propagation. Children start from a minimal environment plus explicitly inherited variables when that matches the reference.
- **Network.** Separate request construction, transport, response parsing, and domain interpretation. HTTP objects never enter the domain model. Model timeouts, redirects, proxies, and the auth source explicitly when the reference depends on them. Retry deliberately. Define which failures retry, the maximum attempts, backoff, jitter, and the timeout relationship. Never retry non-idempotent mutations automatically. Use a deterministic clock and RNG in tests.
- **Determinism.** Inject the clock, random IDs, temp paths, env, cwd, and hostname only where their values reach observable behavior.

## Output, errors, exit codes

- Stdout and stderr are APIs. Render domain results through a human renderer, a JSON serializer, and quiet mode. Never produce JSON by parsing human text. Machine output carries no progress lines and no ANSI unless the evidence shows it. The usual split puts results on stdout and diagnostics on stderr, but follow the reference where it differs.
- Keep debug logging off stdout and stderr, and redact secrets before formatting. That includes debug representations, error context, and fixtures.
- Define semantic errors (`InvalidArgument`, `ConfigNotFound`, `PermissionDenied`, `ChildProcessFailed`, and so on). One outer mapping turns each into a message, a destination stream, and an exit code, using only codes the contract established. If the reference always exits 1, the candidate does too.
- Only `main` exits: `main → run → Result → exit status`. Never call `process.exit`, `sys.exit`, or `std::process::exit` from inside the core.

## TTY, prompts, signals, concurrency

- Model `stdin_is_tty`, `stdout_is_tty`, and `stderr_is_tty` separately. Colors, progress, prompts, paging, and line rewriting can each depend on a different stream.
- Separate the decision to prompt (`destructive && !force → confirmation required`) from the terminal adapter that asks. Test the policy directly and the prompt under a PTY.
- For Ctrl-C, SIGTERM, broken pipes, and parent or child death, match the reference's cleanup, signal forwarding, exit status, and retained partial state. Model cancellation as owned state, not a global flag.
- Add concurrency only when the contract or a measurement requires it. Then define the units, the output ordering, the limit, cancellation, and error aggregation, and aggregate immutable results deterministically.
- Branch on platform only where behavior truly differs: path separators, PATH lookup, case sensitivity, permissions, symlinks, line endings, signals, executable suffixes, shells, and env-name casing. Keep those branches in one place, outside domain code.

## Per-language shape

Keep the repository's existing framework: Commander, oclif, Click, Typer, clap derive, or clap builder.

- **TypeScript.** Use `src/commands/`, `domain/`, `adapters/`, `output/`, and `config/`. In oclif, declare args and flags, and extract shared logic instead of calling one command from another. Check ESM and CJS behavior of the built bin.
- **Python.** Use `cli/`, `domain/`, `adapters/`, and `output/`. Keep command functions thin, with explicit `Path`, `Enum`, `Optional`, and typed result types. Typer maps annotations to CLI inputs.
- **Rust.** Use `cli.rs`, `commands/`, `domain/`, `adapters/`, `output.rs`, and `error.rs`. Structure clap derive as `Parser`, then `enum Command`, then a typed request, then `Result<DomainResult, DomainError>`, then a renderer. `ArgMatches` never leaves `cli.rs`.

Add a dependency only when the repository and the standard library lack the capability and the dependency clearly simplifies the code. Add a feature flag only for a real operational need, never to hide indecision.
