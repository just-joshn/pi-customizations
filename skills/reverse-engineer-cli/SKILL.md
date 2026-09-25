---
name: reverse-engineer-cli
description: "Reverse engineer a CLI tool (TypeScript/JavaScript, Python, Rust, or native binary) from its source repository, installed executable, or both. Reconstructs the observable contract (commands, options, stdin/stdout/stderr, exit codes, TTY behavior, config and environment precedence, filesystem, process, and network side effects) through an evidence ledger and progressive escalation from black-box probes to tracing, runtime instrumentation, and targeted decompilation, then delivers a verified model, report, and regression tests. For authorized interoperability, debugging, migration, or reimplementation work only. Use when the user runs /skill:reverse-engineer-cli."
license: MIT
disable-model-invocation: true
---

# Reverse engineer a CLI

The product is a verified model, not decompiled code:

```text
INPUTS → PARSING → CONFIGURATION + STATE → DECISIONS → DOMAIN TRANSFORMATIONS → I/O BOUNDARIES → OUTPUTS + SIDE EFFECTS
```

Source, traces, symbols, debugger state, and decompiler output exist only to establish that model. Stop once the model predicts the reference CLI across the probe corpus and survives attempts to falsify it.

Only do this for authorized interoperability, debugging, migration, compatibility testing, maintenance, or reimplementation. Never bypass authentication, licensing, access controls, or other protections. Use synthetic credentials and configuration, never production ones. Do not run unknown binaries as root or administrator. Do not weaken host security to get a trace. Move the probe to a disposable VM instead.

## 1. Set up the workspace

Create `re/` outside the target repository unless the user says otherwise:

```text
re/
├── 00_context/   10_identity/   20_surface/   30_probes/   40_traces/
├── 50_source/    60_binary/     70_model/     80_tests/    REPORT.md
```

Store raw output before writing summaries. Run every CLI invocation through `scripts/probe.py` (in this skill's directory), from the directory that contains `re/`, so each run appends a JSONL record to `re/30_probes/probes.jsonl` with argv, cwd, env overrides, stdin bytes, TTY state per stream, raw stdout/stderr bytes, exit code or signal, duration, target hash, and a filesystem diff. Run `python3 scripts/probe.py --help` for options. Common forms:

```bash
python3 scripts/probe.py --label "unknown flag" --isolate -- tool --bogus
python3 scripts/probe.py --isolate --clean-env --env NO_COLOR=1 --tty both -- tool build
python3 scripts/probe.py --isolate --seed fixtures/proj:work --stdin-file input.bin -- tool fmt -
python3 scripts/probe.py --send-signal INT --after 2 -- tool watch
```

`--isolate` gives each run a fresh `HOME`, `XDG_*`, `TMPDIR`, and `work/` under `re/30_probes/sandboxes/<id>/` and diffs it. `--snapshot DIR` diffs any other directory. On a pty, output line endings become `\r\n`, which is terminal behavior and not the CLI's.

## 2. Keep an evidence ledger

Record every meaningful claim in `re/70_model/ledger.md`:

```text
CLAIM-001
Claim: --config overrides the configuration discovered in $HOME.
Evidence: OBS-014 (probe P-…), TRACE-006, SRC-037
Confidence: high
Reproduction: re/80_tests/config-precedence.sh
```

Evidence classes: `OBS` observed CLI behavior, `SRC` source, `TRACE` syscall/filesystem/process/network trace, `DBG` debugger, `DYN` dynamic instrumentation, `BIN` static binary facts, `DEC` decompiler, `HIST` repository history, `HYP` unverified hypothesis.

Weight evidence in this order: repeated observable behavior > runtime observation correlated with source > source > system trace > debugger/instrumentation > symbol/import evidence > decompiler inference > string-based inference > guess. Decompiler output is evidence, not source code. Never promote a plausible explanation to fact because the source or decompiler output looks convincing.

## 3. Pick the route

Establish identity and the public contract first (`references/probing.md`, Phases A to F). Then follow the route for the evidence you have:

- **Both source and installed CLI.** The installed executable is authoritative for its own behavior. (1) Record its identity. (2) Capture its black-box corpus. (3) Inspect source entrypoints and architecture. (4) Build source in isolation. (5) Replay the identical corpus against the source build. (6) Investigate every difference before correlating internals. (7) Once matched, use source-level instrumentation to explain the reference. Never silently substitute source behavior for installed behavior.
- **Source only.** Entrypoints → command grammar → domain model → dependencies → state and configuration → I/O boundaries → tests → build → execute probes. Still run the real CLI. Tests and source alone do not establish the user-visible contract.
- **Installed CLI only.** Identity → surface → behavioral corpus → filesystem/process/network tracing → package or wrapper discovery → runtime-specific inspection → binary metadata → dynamic instrumentation → targeted decompilation → executable specification. Stay with external observation as long as possible.

## 4. Work each unknown with the loop

```text
QUESTION → 2+ PLAUSIBLE HYPOTHESES → SMALLEST DISCRIMINATING PROBE → RUN → RAW EVIDENCE → UPDATE MODEL → VERIFY
```

Climb this ladder and stop at the first level that explains the behavior with sufficient evidence. Install tools only when a level needs them.

| Level | Method | Where |
|---|---|---|
| 0 | CLI help, docs, completions | `references/probing.md` |
| 1 | black-box input/output probe | `references/probing.md` |
| 2 | filesystem/process/network observation | `references/tracing-and-binary.md` |
| 3 | structural source search | `references/source-branches.md` |
| 4 | a specific source path, proven to execute | `references/source-branches.md`, `references/verification.md` |
| 5 | language-runtime instrumentation (Node inspector, Python introspection) | `references/source-branches.md` |
| 6 | binary metadata, imports, symbols | `references/tracing-and-binary.md` |
| 7 | targeted debugger or Frida trace | `references/tracing-and-binary.md` |
| 8 | Ghidra/Rizin analysis of only the implicated regions | `references/tracing-and-binary.md` |
| 9 | instruction-level debugging, rr record/replay | `references/tracing-and-binary.md` |

After each explained behavior: update the model, add a permanent regression probe to `re/80_tests/`, and try to falsify the conclusion (`references/verification.md`).

**Stop a branch** when the claim is already reproducible, when more evidence would not change an implementation decision, when the behavior belongs entirely to a known dependency, or when the cost exceeds its relevance to observable compatibility.

**Escalate** when two observations conflict, when source and installed behavior disagree, when a nondeterministic failure will not reproduce, when a side effect has no explained owner, or when a critical transformation stays opaque. If two investigations fail on the same assumption, stop and test that assumption.

## 5. Avoid these

- Reading the repository sequentially, decompiling every function, dumping unfiltered syscalls, or tracing every Frida-callable function.
- Assuming README behavior is current, that source matches the installed binary, or that product marketing names the runtime language.
- Inferring configuration precedence from source layout.
- Treating strings as control-flow evidence or decompiler variable names as authoritative.
- Rewriting the tool before the contract is understood.
- Normalizing output differences that nobody has explained.
- Testing only successful inputs, or ignoring the stdout/stderr split.

## 6. Definition of done

With evidence, the model reproduces or explains:

1. the command and subcommand hierarchy;
2. arguments, options, defaults, aliases, and precedence;
3. stdin, stdout, and stderr behavior, and exit-code semantics;
4. TTY versus non-TTY behavior;
5. configuration files, relevant environment variables, and their precedence;
6. filesystem reads and writes, and cache/state directories;
7. child processes, plus network endpoints and protocols where they apply;
8. important data transformations and major control-flow decisions;
9. error handling, recovery, meaningful boundaries, and invalid inputs.

Every important behavior also needs at least one reproducible test. Unresolved behavior is marked unknown, not guessed. Exact reconstruction of internals is not required once the observable behavior is fully explained.

## 7. Deliverables

```text
re/REPORT.md
re/70_model/cli-contract.json      machine-readable command tree
re/70_model/architecture.md
re/70_model/config-precedence.md
re/70_model/side-effects.md
re/70_model/unknowns.md
re/70_model/ledger.md
re/80_tests/
```

`REPORT.md` covers target identity, the source/binary relationship, the CLI command model, the configuration model, runtime architecture, important data flows, child processes, filesystem behavior, network behavior, important algorithms, evidence references, verification performed, known mismatches, and remaining unknowns. Label every statement `OBSERVED`, `VERIFIED FROM SOURCE`, `CORRELATED`, `INFERRED`, or `UNKNOWN`.
