# Correlation, modeling, and verification

## Phase Q: prove that the source path executes

Finding a function that could explain a behavior is not evidence that it ran. Prove execution with at least one of: controlled logging in an isolated source build, a debugger breakpoint, coverage, a tracepoint, Frida, a side effect unique to that branch, or a branch-specific input. Record the resulting chain in `re/70_model/architecture.md`:

```text
input → observed CLI result → runtime event → command handler → domain operation → I/O call → observable side effect
```

## Phase S: invariants and state transitions

Turn traces into a model of states, the operation, transitions, and invariants:

```text
State:       configuration; authenticated or not; cache present or absent; target exists or missing
Transitions: config loaded → input validated → resource resolved → child executed → output formatted
Invariants:  validation precedes mutation; stdout carries machine output; diagnostics go to stderr;
             nonzero child exit maps to CLI exit 2
```

Assert an invariant only after testing several paths that could violate it.

## Phase U: executable specification

Turn each confirmed behavior into a test in `re/80_tests/`. When the claim is about CLI behavior, drive the real process boundary and assert on argv, stdin, stdout, stderr, exit status, filesystem effects, environment handling, and child-process behavior where practical. Do not test private functions as a stand-in for the user-visible contract. Use golden files only for stable, deterministic output. For structured output, parse and compare structures unless the formatting itself is part of the contract. Existing `probes.jsonl` records give expected values that can be replayed.

## Phase V: differential testing

When building a replacement, compatibility layer, or model, send identical input to the reference and the candidate. Compare exit code, stdout, stderr, filesystem, network behavior, child processes, and timing category where relevant. Classify every difference as `EXPECTED`, `REFERENCE NONDETERMINISM`, `CANDIDATE BUG`, or `UNKNOWN`. Never normalize a difference nobody has explained.

## Phase W: generative probing

Once the grammar is understood, generate inputs with fast-check (TypeScript), Hypothesis (Python), or proptest (Rust). Target benign interface properties: argument ordering, path normalization, Unicode, numeric boundaries, repeated options, empty collections, configuration combinations, and serialization round trips. For each counterexample: minimize it, reproduce it directly, add it to the permanent corpus, and find the responsible implementation path.

## Phase X: adversarial check

Before calling an important behavior understood, try to falsify it:

- What other mechanism could produce this result, and what input would distinguish them?
- Did I observe it more than once?
- Could environment state explain it?
- Could a child process own the behavior instead?
- Could source and the installed binary differ?
- Could output be cached?
- Could tracing have changed timing?

While a credible alternative remains, run one more discriminating experiment.
