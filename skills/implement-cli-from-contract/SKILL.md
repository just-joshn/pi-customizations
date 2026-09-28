---
name: implement-cli-from-contract
description: "Implement, extend, port, replace, or repair CLI features in TypeScript, Python, or Rust so observable behavior matches a reverse-engineered contract. Builds an executable compatibility corpus, captures immutable reference results before coding, designs a clean typed internal model, and proves the packaged candidate against the reference with differential tests. Use when implementing from reverse-engineer-cli evidence, a probe corpus, or a reference executable. Invoke with /skill:implement-cli-from-contract."
license: MIT
compatibility: "Pi coding agent. Bundled differential runner requires Python 3.10+ on macOS or Linux and the sibling reverse-engineer-cli probe runner."
disable-model-invocation: true
---

# Implement a CLI feature from its contract

Preserve required observable behavior. Build the cleanest internal design for that behavior. Prove the candidate against the reference. Reverse-engineered information is a specification, not an architecture. Reproduce only software behavior you are authorized to inspect and implement.

```text
reverse engineer → capture evidence → executable contract
  → clean internal model → vertical slice → differential test
  → expand → package real artifact → full verification → ship
```

Resolve supporting paths relative to this skill directory, then use absolute paths in commands. Read references only for the current phase.

## 1. Establish the implementation mode

Choose exactly one primary mode before changing code:

| Mode | Meaning |
|---|---|
| A Extend | Add a feature to the same CLI while preserving existing behavior |
| B Reimplement | Reproduce an existing feature in another implementation |
| C Replace | Replace an existing implementation while preserving public CLI behavior |
| D Port | Move behavior from one language or architecture to another |
| E Repair | Fix behavior whose intended contract was recovered through reverse engineering |

Record implementation mode, target repository, reference executable, reference version or hash, target version or commit, features in scope, features out of scope, and compatibility requirements. Do not begin implementation until these facts are known. Use the packet layout in [references/feature-packet.md](references/feature-packet.md).

## 2. Import reverse-engineering evidence

Start from `reverse-engineer-cli` outputs under `.re/` (behavior, architecture, evidence, command tree, probes, repro). Older trees may use `re/REPORT.md` and numbered folders. If the contract is missing, stop and ask the user to run `/skill:reverse-engineer-cli <target>` first. Only the user can invoke that explicit-only skill.

Expect command tree, arguments, options, defaults, environment, configuration precedence, stdout, stderr, exit codes, filesystem, network, child processes, TTY, signals, errors, edge cases, traces, source locations, versions, and hypotheses.

Classify every statement with the same levels as reverse-engineer-cli:

| Level | Meaning |
|---|---|
| PROVEN | Runtime observation plus matching implementation evidence |
| OBSERVED | Runtime observation; implementation unconfirmed |
| SUPPORTED | Source or binary evidence; runtime untested |
| INFERRED | Indirect evidence only |
| UNKNOWN | Insufficient evidence |

Do not implement `INFERRED` behavior as a hard requirement. Design a probe that upgrades the finding first when the behavior matters.

Separately ask whether a user, automation, another process, or documentation depends on the behavior. Preserve those. Drop implementation accidents (class layout, private IR, parser library choice) unless they leak into the process boundary.

## 3. Encode an executable behavior contract

Do not leave the report as prose. Create a machine-readable corpus under `.re/impl/<feature>/compat/` with cases, fixtures, snapshots, normalizers, and runners. Every important reverse-engineered behavior must map to a contract case that describes the full process boundary (argv, env, cwd, stdin, expected exit, streams, filesystem, network, signals, TTY).

Write the compatibility policy before coding. Exit codes, stream routing, and machine-readable protocols are exact by default. Normalize only genuine nondeterminism or values the policy explicitly excludes. Never add a normalizer because the candidate differs.

Capture immutable reference results for the full safe corpus **before** implementation:

```text
.re/impl/<feature>/compat/reference/<reference-sha256>/<case-id>/
```

Store raw stdout and stderr bytes, not only normalized forms. The reference corpus is the behavioral oracle. Coding first risks redefining expectations around the candidate.

Seed and run cases with the bundled differential driver (it wraps `reverse-engineer-cli` `probe.py`):

```sh
python3 /absolute/skill/scripts/differential.py run \
  .re/impl/<feature>/compat/cases.json \
  --reference 'tool' \
  --candidate '/absolute/path/to/candidate' \
  --out .re/impl/<feature>/compat/differential

python3 /absolute/skill/scripts/differential.py compare \
  --out .re/impl/<feature>/compat/differential \
  --triage .re/impl/<feature>/compat/triage.json
```

Read [references/testing.md](references/testing.md) for case schema, policy tables, difference classes, layers of tests, and the full proof sequence.

## 4. Inspect the target, blast radius, and public usage

If a repository exists, trace entry point, parser, command registration, configuration, dispatcher, application logic, adapters, rendering, error mapping, exit handling, and tests. Find the nearest analogue. Do not add a parallel architecture without evidence the current shape cannot host the feature.

Trace blast radius across callers, shared options, config keys, env vars, serialization, files, cache, network, plugins, hooks, completions, docs generation, telemetry, exit codes, scripts, and CI. Turn each important safety fact into a test.

Write desired public usage and failure modes before designing internals. For each invocation define parsed meaning, stdout, stderr, exit code, and side effects. The CLI contract comes first.

## 5. Design from first principles

Ask what the clean implementation would look like if this behavior had been a day-one requirement. For a meaningful ownership choice, sketch at least two designs and compare caller complexity, ownership, testability, invalid states, branches, dependencies, compatibility cost, and failure handling. Choose the design that removes knowledge from callers, not the one with the most abstractions.

Default flow:

```text
raw process inputs → CLI boundary → typed command request
  → application operation → adapters → typed outcome
  → presentation (stdout, stderr, exit code)
```

CLI frameworks stay at the outer boundary. Domain logic must not depend on Commander, oclif, Typer, Click, clap objects, `process.argv`, `sys.argv`, or `std::env::args` unless the behavior is genuinely CLI-specific.

Model the command as data immediately after parsing. Prefer variants over contradictory boolean bags. Parse external values once at the boundary, then trust internal types. Encode semantic primitives as semantic types. Resolve configuration in one owner. Keep effects explicit as narrow capabilities. Return typed outcomes and render separately. Define errors as part of the contract, with the outer boundary owning process exit. Isolate historical quirks at the boundary with a comment that points at the compatibility test.

Read [references/architecture.md](references/architecture.md) for ports, config merge, output, errors, TTY, signals, retries, atomic writes, language shapes, and anti-patterns that force a redesign.

## 6. Implement one vertical slice, then expand

Dependency order:

```text
contract cases → types → config resolution → application operation
  → adapters → renderer → CLI parser → process tests → package → packaged verification
```

Implement one representative path that covers parsing, configuration, domain behavior, one external dependency, output, and exit status. Run reference versus candidate after that slice. If the second case requires bypassing the chosen abstractions, stop and revisit the design.

Keep temporary comparators, dual runners, and extraction scripts under `compat/`, `scripts/`, `tests/`, or `tools/`. Do not ship them in the CLI runtime. When replacing an internal API, migrate callers and delete the legacy API in one wave.

## 7. Prove with differential testing and the packaged artifact

A feature is not complete when unit tests pass. It is complete when the **built** CLI satisfies the required reference contracts. Prefer `./compat/check` or the differential script above. Never ask an agent to visually compare hundreds of outputs.

Use three test layers: domain (pure rules), boundary (parse, render, exit mapping), and real process (built executable). Snapshot only compatibility-sensitive multi-line output, and review every snapshot diff. Exercise hostile boundaries justified by the feature. Use property tests for invariants reverse engineering stated but did not enumerate.

Verify the artifact users receive (npm package, wheel console script, release binary), not only `ts-node`, `python source.py`, or `cargo test` helpers. Run installation checks, feature-interaction regressions from the blast-radius list, and supported-platform cases when CI allows.

When a comparison fails, classify it before changing expectations:

```text
REGRESSION | INTENTIONAL_CHANGE | REFERENCE_QUIRK
NONDETERMINISM | BAD_TEST | VERSION_MISMATCH
```

## 8. Finish only with evidence

Inspect every changed file for unrelated edits, leftover debug code, duplicated abstractions, domain leaks of compatibility quirks, unnecessary dependencies, and unexpected output changes.

Produce a machine-readable compatibility report and an evidence map (behavior → contract case → implementation owner → test → reverse-engineering probe). Templates live in [references/feature-packet.md](references/feature-packet.md).

Declare complete only when the required observable contract is encoded, ownership is clear, boundaries parse untrusted input, invalid states are hard to represent, the CLI framework stays at the edge, config precedence matches, errors map explicitly, effects are isolated, the packaged artifact passes process and differential suites, blast-radius regressions ran, intentional differences are documented, and a second agent can reproduce verification without trusting the first agent's explanation.

Hard rules the agent must not violate are listed in [references/feature-packet.md](references/feature-packet.md#rules-the-implementation-agent-must-not-violate). The decision tree is in [references/testing.md](references/testing.md#agent-decision-tree).

For Pi loading and documentation provenance, see [references/pi-integration.md](references/pi-integration.md).
