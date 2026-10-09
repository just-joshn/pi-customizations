# Acceptance live-98 schema 001

## Status

`PASS`. Live-98 DRAFT oracles stay byte-identical. The reviewed verifier stays byte-identical at digest `5a33e1d4…1aa7`. A disposable ACC-SETUP-shaped projection carries the packaging fields the verifier requires. Structural verify against that projection returns `structural: PASS` and `authorization: NONE`. No freeze. No owner named. No ledger edits.

## Approach

**Chosen.** Project-then-verify outside `verify-acceptance.mjs`.

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Project-then-verify | Adapter builds disposable ACC-SETUP package from live-98 bytes, then runs the reviewed tool | **Chosen.** Keeps tool digest and oracle digests. Does not weaken confinement. |
| B. Edit verifier for live-98 schema | Change `verify-acceptance.mjs` to accept locator-style cites | Rejected. Leaves digest `5a33e1d4…`, forces supporting-verifier re-review. |
| C. Blocker-only | Document gap, no runnable path | Rejected once locator resolution covered all 98 cites in a disposable package. |

**Data shape.** `Live98Oracles` (per-def locators, no top-level `sources`/`evidence`) project to `AccSetupPackage` (top-level maps, `{key,lines,excerpt}` cites, governance stub, hash files). Organizing structure is one pure projector plus a thin shell that gates digests and invokes the reviewed verifier.

## Schema gap (evidence)

Measured from live-98 oracles vs ACC-SETUP fixture and the verifier's `checkSources` / `checkEvidence` contracts. Artifact: `parity/research/acceptance-live98-schema-001/schema-gap.json`.

| Field | ACC-SETUP (verifier) | Live-98 DRAFT | Gap |
| --- | --- | --- | --- |
| Top-level `definitions.sources` | Required map `key → {path,sha256}` | Absent | Verifier crashes with `Object.entries` on null (bridge probe) |
| Top-level `definitions.evidence` | Required map `key → {path,sha256}` | Absent | Same class of failure after sources are stubbed |
| Citation shape | `{key, lines, excerpt}` | `{key, file, locator, sha256, excerptStatus, …}` | 59/98 cites `locator-unresolved`; 0 cites carry `lines`; 39 carry `excerpt`, not all verbatim-unique |
| Package sidecars | `governance.json`, `MANIFEST.sha256`, `setup-pstack/record-hashes.json` | Missing beside live-98 oracles | Verifier cannot run a clean package check in-place |
| Symbolic evidence refs | File-backed evidence keys only | 5 non-path labels (`written-artifact`, …) | Need stub files for ACC-SETUP evidence map |

Bridge probe exit 1 without projection remains on record at `parity/research/acceptance-live98-verifier-bridge-001/live98-structural-probe.txt`.

## Digests

Measured with `shasum -a 256` after the verify path. Transcript: `parity/research/acceptance-live98-schema-001/01-digests.txt`.

| Artifact | Path | SHA-256 | Note |
| --- | --- | --- | --- |
| Reviewed verifier | `parity/acceptance/tools/verify-acceptance.mjs` | `5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7` | Unchanged. `supporting-verifier-safe-for-custody` still applies. Re-review **not** required. |
| Live-98 definitions | `parity/acceptance/setup-pstack/definitions.json` | `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5` | Unchanged |
| Live-98 configurations | `parity/acceptance/setup-pstack/configurations.json` | `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e` | Unchanged |
| Projected definitions | `parity/research/acceptance-live98-schema-001/projected-acc/setup-pstack/definitions.json` | `c43d9cb740cd8775298c4c9d6a89a0c3a1c0923b2b8860d3da5ad05eb77efc05` | Disposable only. Not an oracle. |

## Artifacts

| Path | Role |
| --- | --- |
| `parity/acceptance/tools/project-live98-for-verify.mjs` | Projects live-98 → ACC-SETUP-shaped disposable package |
| `parity/acceptance/tools/verify-live98-structural.sh` | Digest gates, project, `--write-hashes`, structural verify |
| `parity/research/acceptance-live98-schema-001/schema-gap.json` | Machine-readable gap evidence |
| `parity/research/acceptance-live98-schema-001/projected-acc/` | Disposable package the reviewed tool checks |
| `parity/research/acceptance-live98-schema-001/parity-root/` | Evidence overlay (symlinks to real evidence + symbolic stubs) |
| `parity/research/acceptance-live98-schema-001/live98-structural-verify.json` | Last PASS summary |

Governance inside the projection is a packaging stub (`live98-schema-adapter-packaging-stub` / family `none`). It is not an acceptance owner, custody holder, or freeze authority.

## Structural verify result

```sh
bash parity/acceptance/tools/verify-live98-structural.sh \
  /Users/josh-desktop/src/experiments/plugins \
  parity
```

Result (measured):

- `structural: PASS`
- `authorization: NONE`
- `partition.definitions: 98`
- `partition.configurationCells: 193`
- `partition.denominatorComplete: true`
- `openBlockers`: `NO_AUTHENTICATED_TRANSITION_AUTHORITY`, `NO_REFERENCE_RUN_REGISTRY`, `NO_EXTERNAL_CUSTODY`, `FINAL_ACCEPTANCE_GATE_ABSENT`, `EXTERNAL_PIN_ABSENT`

`DENOMINATOR_INCOMPLETE` is absent because live-98 already claims `denominatorComplete: true`. That claim is still unauthenticated DRAFT metadata.

## Confinement regressions

Scoped selftest and review regressions still target the historical ACC-SETUP fixture and the unchanged tool digest.

```sh
bash parity/acceptance/tools/selftest.sh /Users/josh-desktop/src/experiments/plugins parity
# → selftest passed
bash parity/acceptance/review/regressions/*.sh …
# → all ok
```

Transcripts: `parity/research/acceptance-live98-schema-001/selftest.txt`, `regressions.txt`.

## Freeze and custody

Not frozen. No owner invented for the live-98 oracles. Projection governance is packaging-only. Coordinator must not set `acceptanceDefinitionsFrozen` from this unit.

## Ledger safety

This unit did not edit `parity/requirements.json`, `parity/mismatches.json`, `parity/dependencies.json`, `parity/progress.md`, `parity/source-lock.json`, or `parity/completion.json`. It did not rewrite live-98 oracle bytes. It did not edit `verify-acceptance.mjs`.

## Merge recommendation

Merge the projector, verify wrapper, research evidence, and this report. Keep live-98 oracles DRAFT. Keep the reviewed verifier digest. Treat the projected package as disposable packaging, not a second oracle. Freeze still needs independent owner, custody, and authenticated transition work from freeze-prep. Do not freeze from this unit.

### Operator / coordinator next step

Smallest next step outside this unit. Name a real acceptance owner and custody path (freeze-prep owner/custody/auth failures). Optionally fold `verify-live98-structural.sh` into freeze-prep's structural gate so freeze prep exercises live-98 bytes through the same reviewed tool without editing its digest.
