---
name: implement-cli-from-contract
description: "Implement or port CLI features in TypeScript, Python, or Rust so their observable behavior matches a contract established by reverse engineering (reverse-engineer-cli's re/ deliverables, a probe corpus, or a reference executable). Classifies each behavior as must-match, should-match, implementation detail, or unknown; pins must-match behavior with executable-boundary and differential tests against the reference CLI; and builds the smallest clean, repository-native implementation (thin CLI adapter, typed domain request and result, isolated side effects, one exit-code mapping) instead of copying reference internals. Use when the user runs /skill:implement-cli-from-contract."
license: MIT
disable-model-invocation: true
---

# Implement a CLI feature from its contract

The observed behavior is the specification. The reference's internal code is not.

```text
REFERENCE CLI → OBSERVABLE CONTRACT → EXECUTABLE TESTS → NEW IMPLEMENTATION
```

Success means two things. Users see the established contract. Maintainers see code that looks as if this repository had always implemented the feature. Aim for the smallest clean implementation that reproduces every behavior that matters. Internal architecture may differ completely from the reference.

## 1. Load the contract

Find the reverse-engineering outputs. These are usually `re/REPORT.md`, `re/70_model/` (`cli-contract.json`, `ledger.md`, `config-precedence.md`, `side-effects.md`, `unknowns.md`), `re/30_probes/`, and the reference executable. If they are missing, rebuild the equivalent from the available evidence. Run `/skill:reverse-engineer-cli` first when there is no contract.

For each feature, or each group of tightly coupled features, create a packet under `re/90_impl/<feature>/` from `references/feature-packet.md`. Every implementation decision traces to one of four sources: a compatibility requirement, existing repository architecture, a language or runtime constraint, or a deliberate new design decision.

## 2. Classify every behavior

Put each behavior into exactly one class:

| Class | Meaning | Action |
|---|---|---|
| A MUST MATCH | Observable and compatibility-significant: flags, grammar, exit codes, JSON schema, stderr diagnostics, file locations, config precedence, request formats, child invocations | Pin with a test before implementing |
| B SHOULD MATCH | Observable, probably not depended upon: help spacing, punctuation, ANSI styling, informational message order | Match when cheap or known to be depended upon |
| C IMPLEMENTATION DETAIL | Not observable: names, modules, data structures, dependencies, reference caching internals | Design it cleanly for this repository |
| D UNKNOWN | Not established | Run a discriminating reference probe, or choose a behavior and record it as new behavior |

Never turn an unknown into an assumed compatibility requirement by accident.

## 3. Establish the baseline

Before editing, record the commit, `git status --short`, runtime and compiler versions, lockfile state, and the result of every build, test, lint, typecheck, and format command the repository already supports. Record pre-existing failures separately so you don't attribute them to your change.

## 4. Design

Trace a neighboring command end to end. Cover the entrypoint, parser, config loader, domain layer, filesystem, process, and HTTP adapters, output and error types, and tests. Reuse the patterns and frameworks you find. Do not migrate frameworks, test runners, or formatters, and do not mix in unrelated cleanup, unless the current architecture blocks a correct implementation.

Name the domain contract before writing parser code: typed request, typed result, and semantic errors. Then pick the shallowest design that keeps the CLI thin and side effects isolated. Read `references/architecture.md` for design options, config merge, side effects, output, errors and exit codes, TTY, signals, and per-language shape.

For several features, group the work by shared subsystem, such as config, errors, or output, rather than finishing one command at a time. Extract a shared component only when one real use needs it and a second clearly implies it.

## 5. Write the tests first

Turn each class A behavior into a test that runs the real executable. Assert argv, cwd, env, stdin, TTY mode, exit code, raw stdout and stderr bytes, and filesystem effects. Seed cases from the probe corpus, and confirm each test against the reference before it is allowed to fail against the candidate.

Run the same case file against both executables:

```bash
python3 scripts/differential.py run re/90_impl/<feature>/cases.json \
  --reference 'tool' --candidate '/abs/path/to/candidate' --out re/90_impl/<feature>/differential
python3 scripts/differential.py compare --out re/90_impl/<feature>/differential \
  --triage re/90_impl/<feature>/triage.json
```

The script drives `../reverse-engineer-cli/scripts/probe.py`, so each case's `probe` list takes that script's options. `compare` exits 1 while any difference is unclassified or a case is missing. Read `references/testing.md` for difference classes, justified normalization, the case types to write, and per-language test stacks.

## 6. Implement in vertical slices

Build one representative path end to end first: parse, config, domain, side effect, output, exit. Then apply this loop to every behavior:

```text
evidence → test → passes on reference → fails on candidate → smallest coherent change
→ candidate passes → differential matches → keep
```

Never write large batches of code between differential runs. After each slice, read `git diff --stat` and `git diff`. Look for unrelated edits, duplicated functionality, parser types leaking into domain code, new mutable state, changed existing behavior, and leftover probes.

For any question during implementation, decide in this order:

1. Not externally observable: use the cleanest repository-native implementation.
2. Observable and established: match it and pin it with a test.
3. Observable, unknown, and a small probe can settle it: run the probe.
4. Unknown and it affects future compatibility: choose the most reversible design and record the unknown.
5. Otherwise: choose the simplest design.

Keep externally significant quirks and give each a test that names its evidence. Examples are last duplicate flag wins, an error printed to stdout, or an unusual exit code. Drop accidental internal complexity the contract does not require, such as an intermediate temp file nobody can observe. Do not make output "look nicer" or invent exit codes the reference lacks.

## 7. Harden and verify

Once every differential case matches, simplify. Remove accidental abstractions, one-caller wrappers, temporary logging, dead branches, and obsolete mocks, then rerun the full corpus. Keep only the probes that now serve as regression tests.

Run the full pipeline: format, lint, typecheck or compile, unit, integration, build, package, and the compatibility corpus. Run the corpus against the packaged form (npm-installed bin, wheel console script, release binary) at least once, not just `node src/…`, `python -m`, or `cargo run`. Then run the adversarial review in `references/testing.md` and walk every ledger claim for the feature. Mark each one implemented, tested, deliberately irrelevant, or still unknown. No claim may disappear silently.

## 8. Stop rules

- Stop probing when no implementation decision depends on the unknown.
- Stop abstracting when the architecture expresses the known requirements clearly.
- Stop optimizing when the measured requirement is met. Measure against the reference before optimizing, and only when performance is part of the contract.
- Stop debugging when the original reproducer, its regression test, and the surrounding suite all pass.

## 9. Definition of done

The feature is done when every applicable class A behavior has a passing executable test and a matching differential case. That covers the command, arguments, flags, aliases, defaults, validation, stdin, stdout, stderr, exit status, TTY, config and env precedence, filesystem, child processes, network, signals, errors, machine-readable output, interactive behavior, and contractual help. Existing behavior must still pass, and `compare` must report zero `UNCLASSIFIED` and zero `MISSING`. Deliver the completion report from `references/feature-packet.md`. Enumerate the evidence, and never write "everything works".
