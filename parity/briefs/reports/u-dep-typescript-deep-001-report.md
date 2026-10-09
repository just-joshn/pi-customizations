# Report: typescript@7.0.2 deep compiler-behavior semantics

## Status

VERDICT `still-open-with-merge-note`. Merge payload ready for coordinator evidence refresh only. Ledgers not edited. No commit. No invented conformance suite.

throughput checkpoint: n/a, read-only investigation

## Overview

`npm:typescript@7.0.2` still lacks a compiler-test oracle for deep AST/enum/helper semantics across the 136 `internal_module_surface` files. Wave-009 already recorded that catalog re-verify and consumer typecheck are not proof. This unit re-ran those non-closing checks, proved the npm tarball ships no tests, and sharpened the open-line blocker. The unresolvedReference stays.

## Key concepts

- Deep compiler-behavior semantics means exercised AST/enum/helper contracts with recorded expected outputs, not file hashes or `tsc --noEmit` exit codes.
- Catalog hash equality proves custody of published bytes. It does not prove compiler behavior.
- The published `typescript@7.0.2` package `files` field is `bin`, `lib`, `dist`, `vendor`. There is no in-package test suite to run as an oracle.
- Prior `dep-typescript-oracle-001` minimal emit failed (`TS5042`, exit 1, empty emit hashes) and is explicitly not closure.

## How it works

Rerunnable lever `parity/research/dep-typescript-deep-001/probe_deep_semantics.py` re-hashes the wave-009 disposition, re-verifies all 136 catalogued internal files against the locked install tree, records package top-level layout and `files` field, re-runs `tsc --version` and `bun run typecheck`, and writes disposition plus merge payload.

Double-run VERIFY kept stable fields. `catalogHashDriftCount=0`, `verifiedInternalFileCount=136`, typecheck exit `0`, `tsc --version` `Version 7.0.2`, verdict `still-open-with-merge-note`, `removeUnresolvedReference=false`.

Final artifact hashes (from last probe run):

| Artifact | sha256 |
| --- | --- |
| Wave-009 disposition | `a3ac9a4f564b3f698dccfdf2dce74f9ec729c3e517bf60dbbc9f9fc579730bb2` |
| Unit disposition | `54a2b55db5eb26545476cf15af7f1f7bbb3d45f8907e0f501d16adf7b4e5c7f9` |
| Merge payload | `c078be629275b4e25e7d18a08e8c9cda0063d09e69ddfe224cd1a8968a7416b9` |

## Where things live

| Artifact | Path |
| --- | --- |
| Probe lever | `parity/research/dep-typescript-deep-001/probe_deep_semantics.py` |
| Disposition | `parity/research/dep-typescript-deep-001/disposition.json` |
| Merge payload | `parity/research/dep-typescript-deep-001/merge-payload.json` |
| Hash verify | `parity/research/dep-typescript-deep-001/verify-hashes.json` |
| Prior wave-009 | `parity/research/dep-closure-wave-009/npm/typescript-deep-semantics-disposition.json` |
| Prior minimal oracle | `parity/research/dep-typescript-oracle-001/` |

## Acceptance checks

| Check | Result |
| --- | --- |
| Clear verdict closed-with-oracle or still-open-with-merge-note | `still-open-with-merge-note` |
| If closed: oracle command + hashes | n/a (not closed) |
| If open: merge refreshes pointers only | `removeUnresolvedReference=false`; `keepAndRefresh` replaces wave-009 text with unit disposition pointer |
| No fake closure via typecheck/catalog | Honesty block + `doNotClaim` list in disposition |
| No ledger edits | Worker wrote only under owned research/report paths |
| No invented full conformance suite claim | Explicit forbid recorded; npm package has no tests dir |

## Gotchas

- Closing would require a pinned compiler-test oracle with path+hash evidence covering the 136 internal contracts. This unit does not claim that oracle exists.
- Do not remove the unresolvedReference because typecheck or catalog drift is clean.
- Do not set `completeDependencyClosure` true.

## Merge payload summary

Coordinator apply (worker does not edit ledgers):

1. Append unit disposition paths to `npm:typescript@7.0.2` readingEvidence.
2. Set `deepCompilerSemanticsStatus` / disposition note from the unit disposition (`still_open`).
3. Refresh the existing unresolvedReference string via `keepAndRefresh` (do not remove).
4. Keep `completeDependencyClosure` false.

Full JSON: `parity/research/dep-typescript-deep-001/merge-payload.json`.

## Sharper blocker

No compiler-test oracle exists for `typescript@7.0.2` deep semantics. The npm package ships no tests. Prior minimal emit under `dep-typescript-oracle-001` failed and does not cover the 136 `internal_module_surface` contracts. Catalog re-verify (`catalogHashDriftCount=0`) and consumer typecheck (exit 0) remain non-proof.

What would close it: a pinned microsoft/TypeScript (or equivalent) compiler-test run at 7.0.2 semantics, exercising AST/enum/helper contracts for those 136 files, with command, exit codes, and path+sha256 evidence for expected outputs.

## Verify command

```bash
python3 parity/research/dep-typescript-deep-001/probe_deep_semantics.py
# Inspect stable fields in verify-hashes.json / printed JSON:
# catalogHashDriftCount, typecheckExit, verdict, removeUnresolvedReference
```
