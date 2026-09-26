# Architecture for a contract-driven CLI feature

This is a logical architecture. Collapse any layer that provides no useful boundary.

```text
raw process inputs
        |
        v
CLI boundary
        |
        v
typed command request
        |
        v
application operation
        |
        +----> filesystem adapter
        |
        +----> network adapter
        |
        +----> process adapter
        |
        v
typed outcome
        |
        v
presentation boundary
        |
        +----> stdout
        +----> stderr
        +----> exit code
```

## Choose the shape

When ownership is not obvious, sketch at least two designs. Example:

```text
Design A: CLI parser → command handler → domain operation → adapters
Design B: CLI parser → generic dispatcher → stateful service → adapters
```

Compare caller complexity, ownership, testability, invalid states, branches, external dependencies, compatibility complexity, and failure handling. Choose the design that removes knowledge from callers. Do not choose the design with the most abstractions.

Default to a thin command plus a domain operation. Escalate to explicit ports only when several side effects, heavy testing, determinism, or reuse across frontends demand it. Commands share domain operations. A command never invokes another command unless the contract shows it spawning one.

Do not add a new architecture next to an existing one without evidence that the current shape cannot support the feature.

## Model the command as data

Convert parser output into a domain request immediately. Do not pass parser framework objects into the application.

```text
tool deploy prod --force --timeout 30
        →
DeployRequest { environment = Production, force = true, timeout = 30s }
```

Prefer variants over boolean combinations. `DeployMode = Preview | Execute | Rollback` beats three mutually exclusive booleans. Give states that behave differently their own variants. Keep provenance (`Resolved<T> { value, source }`) when the source affects diagnostics or later behavior.

## Parse external values once

Treat argv, environment, configuration, stdin, JSON, filesystem contents, HTTP responses, and IPC as untrusted until parsed:

```text
raw value → parse → validate → typed value → application
```

Do not scatter validation through business logic. Trust internal types after the boundary.

## Encode semantic values as semantic types

Prefer `ProjectPath`, `ConfigPath`, `ApiToken`, `EnvironmentName`, `Timeout`, `OutputFormat`, and `RepositoryUrl` over interchangeable primitives.

- TypeScript: branded values or discriminated unions; `unknown` for unparsed external data; exhaustive switches; no casual `as` or `any`.
- Rust: newtypes and enums; exhaustive match; `Result<T, E>`; `PathBuf` for paths.
- Python: enums, dataclasses (frozen where appropriate), Protocols for capabilities, constructors that validate at the boundary.

## Configuration resolution is one operation

Encode the reverse-engineered precedence in one owner:

```text
defaults → user config → project config → environment → CLI → ResolvedConfig
```

Do not let feature modules independently inspect `process.env`, `os.environ`, `std::env`, config files, or parser state. The application receives a resolved value. Parse defaults as absent when config can override them so "unspecified" differs from "explicitly the default".

## External effects are explicit

If the feature performs I/O, isolate it as narrow capabilities (`Filesystem`, `HttpClient`, `ProcessRunner`, `Clock`, `CredentialStore`, `Terminal`). Pass only what the operation needs. Plain parameters or small service objects are enough. Do not build a dependency-injection framework for this.

- **Filesystem.** Centralize path resolution, creation, overwrite, permissions, symlinks, temp files, and cleanup. When writes must not be partial, generate content, write a temporary file, flush when required, then rename into place. Preserve an existing atomicity contract. Model multi-step persistent transitions instead of scattering writes.
- **Child processes.** One interface with executable, args, cwd, env, and stdin mode. Use argv arrays, never shell strings, unless the contract needs shell semantics. Preserve stream and signal behavior the reference established.
- **Network.** Separate request construction, transport, response parsing, and domain interpretation. Define which failures retry, maximum attempts, backoff ownership, and whether the operation is idempotent. Never retry non-idempotent mutations automatically. Encode convergence under repeat delivery in tests when required.
- **Determinism.** Inject clock, random IDs, temp paths, env, cwd, and hostname only where their values reach observable behavior.

## Output stays separate from operations

Do not print from business logic when output compatibility matters. Return typed outcomes, then render:

```text
InspectOutcome = PackageFound(...) | PackageMissing(...) | InvalidArchive(...)
render_human(outcome) / render_json(outcome)
outcome/error → stdout/stderr → exit code
```

Stdout and stderr are APIs. Never produce JSON by parsing human text. Machine output carries no progress lines and no ANSI unless the evidence shows it. Preserve machine-readable formats more strictly than human output. Define typed schemas for `--json`, NDJSON, CSV, and protocol messages. Do not serialize internal structs casually.

## Errors are part of the contract

```text
CliFailure = UsageError | InvalidConfig | InputNotFound
  | AuthenticationFailure | RemoteFailure | OperationFailure
```

Each variant owns exit code, human message, machine-readable representation, and whether retry makes sense. The outer boundary owns process termination. Only `main` exits: `main → run → Result → exit status`.

## Preserve strange behavior at the boundary

Historical misspellings, unusual exit codes, option overrides, stderr-on-success, odd precedence, and legacy JSON properties stay at adapters such as `CompatibilityRenderer`, `LegacyConfigParser`, or `ExitCodeMapper`. Do not infect the domain model. Comment with a pointer to the compatibility test, not a speculative history.

## TTY, signals, and cancellation

Terminal capability usually feeds the renderer or prompt boundary, not business logic. Model `stdin_is_tty`, `stdout_is_tty`, and `stderr_is_tty` separately when color, progress, prompts, paging, or line rewriting depend on them.

The outer process layer handles SIGINT, SIGTERM where applicable, and terminal cancellation. Translate into application cancellation. The operation decides how to stop work, clean temporary state, cancel children, and close resources. The CLI boundary then selects the externally compatible exit behavior. Test cancellation on the actual executable.

## Language-specific shape

Prefer the framework already used by the repository.

### TypeScript

For greenfield work, choose by CLI size. Commander (with `@commander-js/extra-typings` when useful) fits command/argument/option programs. oclif fits plugin architecture, command discovery, hooks, large trees, and framework-managed help. Keep either at the boundary.

```text
src/
  cli/commands/  parse.ts  render.ts  exit.ts
  domain/
  adapters/filesystem.ts  http.ts  process.ts
  config/resolve.ts
```

For true process tests, Execa exposes typed subprocess execution with independent streams, env control, timeouts, and termination behavior. Vitest snapshots suit committed compatibility-sensitive CLI output. Review every snapshot update.

### Python

Typer remains a strong typed greenfield fit. Click is fine when already present.

```text
src/tool/
  cli.py  commands/  domain/  adapters/
  config.py  errors.py  render.py
```

Use Enum, dataclass, Protocol, `pathlib.Path`, and explicit result variants. Typer `CliRunner` is useful for boundary tests. Keep subprocess tests for compatibility-critical behavior. Use `uv` for locked environments, installed commands, builds, and install verification. The final compatibility suite runs the installed console script from the built package.

### Rust

Prefer clap when already present or for a conventional Rust CLI. Derive maps arguments to structs and subcommands to enums.

```text
src/
  main.rs  cli/  domain/  adapters/
  config.rs  error.rs  render.rs
```

Keep `clap::Parser` types at the CLI boundary. Convert to application requests before domain logic. Process-level tools include `assert_cmd`, `assert_fs`, `trycmd`, and `snapbox`. Use process-level tests for the compatibility suite even when internal tests call Rust functions directly.

## Redesign signals

Stop and redesign when the same special case appears in several handlers, optional fields depend on each other, casts and null assertions repeat, several modules compute the same rule, CLI framework objects reach deep into the application, multiple modules read the same environment variable, error-to-exit mappings diverge, or tests require extensive mocks. Fix ownership or the data model. Do not cover the smell with another helper.

## Migrate then delete

When replacing an internal implementation, design the new internal contract, inventory callers, migrate every caller, and delete the old API. Do not leave `oldOperation`, `newOperation`, and `legacyOperationAdapter` indefinitely. External CLI compatibility and internal API compatibility are different concerns.
