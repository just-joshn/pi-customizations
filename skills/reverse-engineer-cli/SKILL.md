---
name: reverse-engineer-cli
description: "Reverse engineer TypeScript/JavaScript, Python, or Rust CLI tools from an installed command, a repository, or both. Use for authorized behavior reconstruction, architecture analysis, configuration precedence, release comparisons, or preparation for a compatible implementation. Produces reproducible probes and evidence-linked behavior and architecture reports. Invoke with /skill:reverse-engineer-cli followed by the target and investigation scope."
license: MIT
compatibility: "Pi coding agent. Bundled automation requires Python 3.10+ on macOS or Linux; Windows investigations require equivalent native capture tooling. Optional analysis tools are selected per target."
disable-model-invocation: true
---

# Reverse engineer a CLI

Reconstruct the behavior that matters, identify its implementation where possible, and leave evidence another operator can replay. Analyze only software the operator owns or is authorized to inspect. Resolve supporting paths relative to this skill directory, then use absolute paths in commands. Read references only for the current phase.

## 1. Establish scope and identity

Use the user's target, available artifacts, and compatibility questions. If the target is missing, ask for it. Otherwise proceed with the available evidence. Record scope, required behaviors, exclusions, and unknowns in `.re/report/behavior.md`.

Read [references/probing.md](references/probing.md). Create the evidence workspace before invoking the target:

```sh
python3 /absolute/skill/scripts/investigate.py init --workspace .re --target /absolute/path/to/tool --repository /absolute/path/to/repository
```

Omit whichever input is unavailable. This initializes the requested layout, records file identity and repository state, copies the reproduction helpers, and leaves empty probe cases. It does not run the target. Add `--artifact PATH` for each discovered runtime, package entry point, bundle, or relevant package manifest that needs hash verification. Large artifact trees can use a separately recorded file manifest.

If an installed command exists, start with that command before the repository. Resolve aliases, functions, shims, symlinks, and wrappers through to the runtime and application entry point. Hash and, when practical, copy each relevant artifact without changing the installed executable. A wrapper hash does not identify its dependencies.

If both inputs exist, version correspondence is mandatory. Record version strings, build IDs, commits, dirty state, and package metadata. A matching version string is insufficient. Replay the same relevant corpus against the installed executable and an isolated source build. Keep installed and repository models separate until their relationship is established. Behavioral agreement applies only to the tested scope; binary equality is unnecessary.

## 2. Capture the public contract

Use supported help/version forms first; capture nested subcommands, invalid syntax, and missing arguments. Bare invocation may mutate state, start a server, or enter a REPL. Assess it before running it. Help is evidence of advertised syntax, not proof of actual behavior.

Record `.re/source/command-tree.json` with commands, options, arguments, defaults, repeatability, environment/config counterparts, conflicts, dependencies, possible values, evidence IDs, and unknowns. Record help stream and exit status.

Run several targeted manual probes, then encode the repeating experiment in `.re/probes/cases.json`. Read [references/reproduction.md](references/reproduction.md) for the executable corpus format and helper limits. Every case must have a question, reviewed scope, controlled input, and expected observations when established.

```sh
python3 .re/repro/scripts/probe.py --out .re/probes/manual --isolate --clean-env --label 'Which stream receives help?' -- /absolute/path/to/tool --help
python3 .re/repro/run-all
```

The runner preserves raw streams separately, stdin, environment changes, TTY state, signals, timings, hashes, and filesystem snapshots. Clean environment and temporary directories are experimental controls, not OS containment. Use an OS sandbox or VM when probes might escape fixtures, reach real services, or execute untrusted code. Never use live user data when disposable fixtures suffice.

Cover the relevant behavioral matrix from `probing.md`. Derive configuration precedence with distinct values at every layer, pairwise conflicts, and removal of winning layers. Test empty/unset values, merge semantics, discovery roots, and error timing. Do not assume a global total order when fields follow different rules.

## 3. Explain the implementation

Select the route:

| Available evidence | Route |
|---|---|
| Repository and installed command | Establish identity, probe installed behavior, trace source, compare isolated build, correlate only matching paths |
| Repository only | Resolve the declared entry point, trace source, build in isolation when feasible, probe the resulting artifact; label unexecuted conclusions SUPPORTED |
| Installed command only | Resolve launcher and package, probe behavior, inspect recoverable source, trace boundaries, escalate to native analysis for remaining questions |

Read [references/source-branches.md](references/source-branches.md) for the language. Follow the actual entry point through parser, configuration, dispatch, application operation, adapters, presentation, and exit selection. For each boundary record inputs, validation, transformations, state reads/writes, external calls, streams, and errors. Investigate important algorithms with discriminating fixtures, including boundary values and failure paths.

Use `rg` for discovery, then AST search, Tree-sitter queries, Ctags JSON, or compiler metadata for the relevant constructs. Build a small symbol map. Do not index or read the entire repository by default.

If source cannot resolve a question, read [references/tracing-and-binary.md](references/tracing-and-binary.md). Escalate only as needed:

```text
process/filesystem/network observation → targeted runtime debugging
→ recover packaged source → native metadata/symbols/imports/strings
→ targeted Frida instrumentation → candidate-function decompilation
```

Recover JS source maps and Python package/archive contents before native decompilation. Preserve archive/member provenance and prevent extraction paths from escaping the recovery directory. Never infer framework behavior, bytecode semantics, or decompiler names/types without evidence.

## 4. Resolve competing explanations

Maintain `.re/hypotheses/open.md` and `resolved.md`. For each question record hypotheses, evidence for/against, the smallest discriminating probe, result, and status. Choose an experiment whose predicted outcomes differ. Do not repeat an inference until it sounds established.

Join runtime observations, traces, source symbols, and binary locations in `.re/report/evidence.md`. Read [references/verification.md](references/verification.md) before closing a claim. Use exactly these levels:

| Level | Required evidence |
|---|---|
| PROVEN | Direct runtime observation plus matching implementation evidence |
| OBSERVED | Direct runtime observation; implementation unconfirmed |
| SUPPORTED | Direct source/binary evidence; runtime untested |
| INFERRED | Indirect evidence supports the explanation |
| UNKNOWN | Insufficient evidence |

Decompiled pseudocode alone generally supports an inference. Direct symbol/import/instruction facts can be SUPPORTED. Do not use confidence percentages. Source alone cannot establish runtime behavior when the executable is available for testing.

For multiple releases, identify each artifact independently, replay the same corpus, compare behavior first, then inspect the responsible implementation changes. Preserve stdout, stderr, exit status, effects, and timings. Keep raw and normalized outputs; document every normalization and never hide unexplained differences.

## 5. Deliver and verify

Use [references/report-templates.md](references/report-templates.md) to complete:

- `.re/report/behavior.md`: public contract, configuration, environment, I/O, errors, effects, TTY, edge cases, and scoped gaps.
- `.re/report/architecture.md`: launcher, dispatch, configuration flow, meaningful components and state, algorithms, external boundaries, and a data-flow diagram.
- `.re/report/evidence.md`: claims with levels, artifact identity, probe/trace/source/binary references, alternatives, and replay commands.
- `.re/repro/`: reviewed fixtures and scripts sufficient to reproduce major observations with one command.

Before completion, rerun the safe corpus, verify hashes, challenge major claims against alternatives, and inspect actual evidence files. Reproduction failures, unavailable tracing, source/build mismatches, and untested branches remain explicit gaps. The bundled runner's success only covers its recorded assertions; attach target-specific checks for traces, network/process effects, normalization, and algorithms where required.

Finish only when the requested behavior is reproduced, the responsible path is identified where possible, meaningful alternatives are tested, and another agent can replay the evidence. A successful build or decompilation does not satisfy this condition. If access or tooling blocks a required conclusion, deliver the partial evidence and identify the blocking gap.

For Pi loading and documentation provenance, see [references/pi-integration.md](references/pi-integration.md).
