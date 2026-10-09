# Report: typescript@7.0.2 compiler-test oracle suite

## Status

VERDICT `closed-with-oracle`. Merge can remove the typescript deep compiler-behavior `unresolvedReference`. Ledgers not edited. No commit. No invented suite.

throughput checkpoint: n/a, research oracle unit under figure-it-out

## Overview

`npm:typescript@7.0.2` deep compiler-behavior semantics close with a pinned `microsoft/typescript-go` oracle. The published package `gitHead` is `2bd066d87f5bafd315be9f40889d0a60b9e58e0b`, which exists on `typescript-go` and not on `microsoft/TypeScript`. At that pin, `hereby test:api` passes 459/459 (including astnav). The built `_packages/native-preview/dist/{ast,enums,internal}` tree is byte-identical to the locked npm package for all 136 `internal_module_surface` catalog files.

## Key concepts

- Deep semantics here means exercised AST/enum/helper contracts with recorded expected outputs, not catalog hash alone and not consumer `tsc --noEmit`.
- The npm tarball still ships no tests. The oracle lives in the git-pinned source tree, then is tied back to published bytes by hash equality.
- `microsoft/TypeScript` tag `v7.0.2` is the wrong pin for this package. Its archive `package.json` reports version `6.0.0`, and the npm `gitHead` is absent from that repo.
- `hereby test:api` is the bounded suite for the published JS internal module surface. Full `hereby test` (Go conformance against the TypeScript submodule case corpus) was not required to close this reference and was not run.

## How it works

1. Confirm `typescript@7.0.2` `package.json` `gitHead`.
2. Fetch `microsoft/typescript-go` archive at that SHA (`go-fetch/tarball-sha256.txt`).
3. `npm ci`, build `tsgo`, run `npx hereby test:api`.
4. For astnav, fetch submodule file `src/services/mapCode.ts` at gitlink `4d4f005c8541e0255a9d8791205fdce326e462bc`.
5. Hash-compare the 136 catalog paths in built `dist` versus locked install `node_modules/typescript`.
6. Rerun via `probe_oracle_suite.py` until stable fields match.

Stable VERIFY fields (double probe run):

| Field | Value |
| --- | --- |
| verdict | `closed-with-oracle` |
| removeUnresolvedReference | `true` |
| pinOk | `true` |
| testApiExit | `0` |
| tests / pass / fail | `459` / `459` / `0` |
| builtMatchesPublishedCount | `136` |
| catalogVsPublishedDriftCount | `0` |
| astnavSkipped | `false` |

Final artifact hashes from last probe:

| Artifact | sha256 |
| --- | --- |
| disposition.json | `5317bef7fe3e6425fdc4ce6d144b8034496941823aa36764998ecae67e920876` |
| merge-payload.json | `05dfd342d3aa119e7aade8d65df24f9bddefc24707c6428df48cec78a26590c1` |
| built-vs-published-136.json | `324b748d678153d1101963a869808d1206db83c32842d6ad95b13068c081f78f` |
| verify-hashes.json | `b7ad4f825e5230a64e0ce6fde6d7ee279731744bd0cfb636f2be50ba5fef3e13` |
| typescript-go pin tarball | `5ccb47dbb3f68cd0da58b71e6f445eee36a50bd3e9f9f330cc23a97b88500119` |
| TypeScript tag v7.0.2 tarball (non-pin control) | `8472f284b1465f5c4826a64c88853eccba667446f31a435ed1d0b28d373dbc0b` |

## Where things live

| Artifact | Path |
| --- | --- |
| Probe lever | `parity/research/dep-typescript-oracle-suite-001/probe_oracle_suite.py` |
| Disposition | `parity/research/dep-typescript-oracle-suite-001/disposition.json` |
| Merge payload | `parity/research/dep-typescript-oracle-suite-001/merge-payload.json` |
| 136 compare | `parity/research/dep-typescript-oracle-suite-001/built-vs-published-136.json` |
| Decision trail | `parity/research/dep-typescript-oracle-suite-001/decisions.tsv` |
| Pin checkout | `parity/research/dep-typescript-oracle-suite-001/go-fetch/typescript-go-2bd066d87f5bafd315be9f40889d0a60b9e58e0b/` |
| Prior deep-001 | `parity/research/dep-typescript-deep-001/` |

## Acceptance checks

| Check | Result |
| --- | --- |
| closed-with-oracle + merge removing unresolvedReference, or still-open with measured blocker | `closed-with-oracle`; `removeUnresolvedReference=true` |
| Reproduce commands in report | below |
| No ledger edits | worker wrote only under owned research/report paths |
| No fake suite / no consumer-typecheck closure claim | honesty block in disposition |
| No commit | none |

## Gotchas

- Do not re-pin to `microsoft/TypeScript` `v7.0.2` for this npm package. Use `typescript-go` at the published `gitHead`.
- `hereby test:api` depends on a local Go toolchain (`go 1.26+`) and `npm ci` inside the pin tree.
- Without `mapCode.ts` from the submodule commit, astnav skips and the closed predicate fails.
- Full Go conformance (`hereby test`) remains unrun. That is intentional scope for this unit. Closure is for the 136 internal module surface contracts, not the entire compiler case corpus.
- Keep `completeDependencyClosure` false until other unresolved lines are gone.

## Merge payload summary

Coordinator apply (worker does not edit ledgers):

1. Append unit evidence paths to `npm:typescript@7.0.2` readingEvidence.
2. Set `deepCompilerSemanticsStatus` to `closed_with_oracle`.
3. Remove the unresolvedReference matching `npm:typescript@7.0.2 deep compiler-behavior semantics`.
4. Keep `completeDependencyClosure` false.

Full JSON: `parity/research/dep-typescript-oracle-suite-001/merge-payload.json`.

## Reproduce / verify

```bash
# Requires: Node 20+, Go 1.26+ on PATH (mise install go@1.26), network for first fetch.
export PATH="$HOME/.local/share/mise/shims:$PATH"

# One-shot rerun (rebuilds compare + disposition from existing pin tree):
python3 parity/research/dep-typescript-oracle-suite-001/probe_oracle_suite.py

# Inspect stable fields:
python3 - <<'PY'
import json
from pathlib import Path
v=json.loads(Path('parity/research/dep-typescript-oracle-suite-001/verify-hashes.json').read_text())
for k in ['verdict','removeUnresolvedReference','testApiExit','tests','pass','fail',
          'builtMatchesPublishedCount','catalogVsPublishedDriftCount','astnavSkipped']:
    print(k, v[k])
PY
```

First-time pin bootstrap (already done under `go-fetch/`):

```bash
OUT=parity/research/dep-typescript-oracle-suite-001
curl -fsSL -o "$OUT/go-fetch/typescript-go-2bd066d.tar.gz" \
  https://github.com/microsoft/typescript-go/archive/2bd066d87f5bafd315be9f40889d0a60b9e58e0b.tar.gz
# extract, npm ci, then probe_oracle_suite.py (which runs hereby test:api)
```
