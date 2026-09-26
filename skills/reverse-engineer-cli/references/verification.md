# Correlation and verification

## Claim gate

For every significant claim, point to exact raw observations, reproduction case, relevant source symbol/revision or binary location, and the tested scope. Ask whether another mechanism could yield the same result. Check environment, caches, child ownership, source/install mismatch, and instrumentation effects before selecting a discriminating probe.

PROVEN requires a runtime observation and matching implementation evidence. OBSERVED describes tested behavior without a confirmed implementation path. SUPPORTED describes direct source/binary facts without runtime confirmation. INFERRED names an indirect explanation. UNKNOWN marks insufficient evidence. Never replace these with percentages or informal high/low confidence labels.

A plausible source function does not prove it executed. Use a branch-specific input, debugger, coverage, narrow runtime trace, or logging in an isolated build to link the observed behavior to the path. Do not modify the shipped target. Record build differences and establish behavioral agreement before transferring findings.

Example correlation:

```text
C-014 OBSERVED: deploy --dry-run opens project.toml before printing its plan.
Runtime: P-014 plus traces/filesystem/P-014.log, open event at offset N.
Source: revision ABC, deploy.ts, loadProjectConfig; correspondence unconfirmed.
Alternative: startup config loader also opens that file.
Next: trace call ownership or choose an input distinguishing both paths.
```

After source correspondence and ownership are confirmed, update the level and evidence. Preserve the prior hypothesis and resolution.

## Behavioral and architectural models

Model meaningful state transitions and ownership. Distinguish parser validation, configuration loading, application decisions, adapters, and presentation. Test error boundaries and whether mutation occurs before failure. Assert invariants only over the tested domain; avoid extrapolating from one successful case.

For algorithms, use fixtures whose outputs differ between plausible implementations. Preserve minimized counterexamples and boundary inputs in the permanent corpus. Generative tests are optional after the grammar is understood; random input spraying is not an investigation plan.

## Differential comparison

Compare releases or isolated source builds with identical corpus/fixtures and recorded environments. Compare exit status, signal, stdout, stderr, filesystem effects, process/network effects, default values, command tree, precedence, and performance when contractual. Investigate behavior differences before source or binary diffs. Classify differences with a reason and evidence; normalization never excuses an unexplained discrepancy.

Exact native binary hashes may differ for the same source because of timestamps, toolchain, paths, signing, flags and linking. Require relevant behavioral agreement and identity provenance, not byte equality. Agreement over a small corpus does not prove all behavior equivalent.

## Completion review

Rerun `repro/run-all` and inspect raw files and assertions. Ensure expected observations are genuine assertions rather than narrative claims. Audit major claims against alternatives and the identity of the artifact that produced them. Report unmeasured systems, missing tools, unsupported cases, and unresolved hypotheses explicitly.

Completion means the requested behavior is reproduced, the implementation path is identified where possible, relevant alternatives are tested, and another operator can rerun the evidence. Scope can exclude irrelevant internals, but required unknowns cannot silently disappear. Successful compilation, parser coverage, or decompiler output alone does not establish completion.
