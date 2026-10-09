# Acceptance live-98 verifier bridge 001

## Status

`BRIDGED`. The repaired verifier sits under `parity/acceptance/tools/` next to the live-98 DRAFT oracles. Tool digest equals `5a33e1d4…1aa7`. Live-98 definition and configuration digests are unchanged. No freeze. No owner named. No ledger edits by this unit.

## Digests

Measured with `shasum -a 256` and `cmp` against the owner worktree tool.

| Artifact | Path | SHA-256 | Note |
| --- | --- | --- | --- |
| Bridged verifier | `parity/acceptance/tools/verify-acceptance.mjs` | `5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7` | Byte-identical to owner tool (`cmp` match) |
| Live-98 definitions | `parity/acceptance/setup-pstack/definitions.json` | `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5` | Unchanged |
| Live-98 configurations | `parity/acceptance/setup-pstack/configurations.json` | `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e` | Unchanged |
| Historical fixture defs | `parity/research/acceptance-live98-verifier-bridge-001/acc-fixture/setup-pstack/definitions.json` | `e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4` | ACC-SETUP 43-def partition for scoped selftest |
| Historical fixture configs | `parity/research/acceptance-live98-verifier-bridge-001/acc-fixture/setup-pstack/configurations.json` | `3755a29140cdbf700f01eadd5e268b3abc459152c619bd0037bfe70cc355a80f` | Same |

## Re-review

**Not required** for the bridged tool. Digests match the rereview-002 write-confinement flip target. `supporting-verifier-safe-for-custody` for digest `5a33e1d4…1aa7` still applies to this copy. Selftest and regression wrappers were adapted. Those scripts are not the confinement subject of the flip.

## Package layout

| Path | Role |
| --- | --- |
| `parity/acceptance/tools/verify-acceptance.mjs` | Bridged verifier (byte-identical) |
| `parity/acceptance/tools/selftest.sh` | Scoped selftest (live-98 digest gates + historical fixture suite) |
| `parity/acceptance/review/regressions/*.sh` | Confinement and pin regressions pointed at the historical fixture |
| `parity/research/acceptance-live98-verifier-bridge-001/acc-fixture/` | Disposable ACC-SETUP tree the verifier can structurally check today |
| Live-98 `setup-pstack/*.json` | Freeze-prep candidate oracles (untouched) |

Main `parity/acceptance/` still lacks live-98 `governance.json`, `MANIFEST.sha256`, and `record-hashes.json`. SCOPE forbade adding those beside the oracles. Freeze prep can invoke the bridged tool against a custodian-built tree later.

## Selftest scope

Selftest does three things and passes:

1. Assert bridged tool digest equals `5a33e1d4…1aa7`.
2. Assert live-98 oracle digests are unchanged.
3. Replay the historical ACC-SETUP (43 definitions, 92 configuration cells) structural and write-confinement suite against `acc-fixture/`.

Authorization on a clean fixture verify is `NONE`. Open blockers on that fixture still include `NO_AUTHENTICATED_TRANSITION_AUTHORITY`, `NO_REFERENCE_RUN_REGISTRY`, `NO_EXTERNAL_CUSTODY`, `DENOMINATOR_INCOMPLETE`, `FINAL_ACCEPTANCE_GATE_ABSENT`, and `EXTERNAL_PIN_ABSENT` when unpinned.

Reproduce:

```sh
shasum -a 256 \
  parity/acceptance/tools/verify-acceptance.mjs \
  parity/acceptance/setup-pstack/definitions.json \
  parity/acceptance/setup-pstack/configurations.json
bash parity/acceptance/tools/selftest.sh \
  /Users/josh-desktop/src/experiments/plugins \
  parity
```

Transcripts: `parity/research/acceptance-live98-verifier-bridge-001/selftest.txt`, `regressions.txt`, `01-digests.txt`, `fixture-verify.json`.

## Live-98 structural blocker

The bridged tool still expects the ACC-SETUP partition shape (`definitions.sources`, `definitions.evidence`, citation `excerpt`/`lines`). Live-98 DRAFT records use per-definition source locators without those top-level maps. A disposable probe that pairs live-98 oracles with stub hash files exits 1 with `Cannot convert undefined or null to object` (`Object.entries` on missing `defs.sources`). Evidence: `live98-structural-probe.txt`.

Adapting the verifier for live-98 schema would change its digest. That new digest would need supporting-verifier re-review before any custody flip applies to the adapted copy. This unit kept the tool byte-identical instead.

## Freeze and custody

Not frozen. No owner invented. Fixture verify reports `authorization: "NONE"`. Coordinator must not set `acceptanceDefinitionsFrozen` from this bridge alone.

## Ledger safety

This unit did not edit `parity/requirements.json`, `parity/mismatches.json`, `parity/dependencies.json`, `parity/progress.md`, `parity/source-lock.json`, or `parity/completion.json`. It did not rewrite live-98 oracle bytes.

## Merge recommendation

Keep the bridged tools and scoped selftest. Keep live-98 oracles DRAFT. Treat schema adaptation for live-98 structural verify as a follow-on that triggers re-review. Do not freeze.
