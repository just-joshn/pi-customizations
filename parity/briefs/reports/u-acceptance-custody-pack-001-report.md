# Acceptance custody pack 001

## Status

Packaged. Not frozen. This unit did not set `acceptanceDefinitionsFrozen` and did not name an owner.

Freeze claimed: no.

## Pack path

`parity/research/acceptance-custody-pack-001/`

Immutable archive: `parity/research/acceptance-custody-pack-001/live98-acceptance-custody-pack.tgz`

## Digests (measured)

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Definitions (live) | `parity/acceptance/setup-pstack/definitions.json` | `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5` |
| Configurations (live) | `parity/acceptance/setup-pstack/configurations.json` | `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e` |
| Definitions (pack) | `parity/research/acceptance-custody-pack-001/pack/definitions.json` | same (byte-identical via `cmp`) |
| Configurations (pack) | `parity/research/acceptance-custody-pack-001/pack/configurations.json` | same (byte-identical via `cmp`) |

Supporting verifier confinement digest (supporting only): `5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7`.

## Verify results

| Check | Result | Evidence |
| --- | --- | --- |
| Live shasum matches pinned digests | PASS | `shasum -a 256` on live paths |
| Pack byte-identical to live | PASS | `cmp -s` |
| `verify-custody-pack.sh` on pack | PASS (exit 0) | `parity/research/acceptance-custody-pack-001/verify-pass.txt` |
| Same script on mutated copy | FAIL (exit 1) | `parity/research/acceptance-custody-pack-001/verify-fail-mutated.txt` |
| Archive extracts and verifies | PASS | tar extract then verify |

## Operator G3 steps (exact)

Documented in `parity/research/acceptance-custody-pack-001/pack/OPERATOR-G3-STEPS.md`.

1. Name an independent owner ≠ implementation parent (and ≠ this worker). Do not invent a name from this pack.
2. Place the pack (or matching measured bytes) in an external immutable store the implementation owner cannot write. Same-user checkout is not external custody.
3. Authorize freeze only after steps 1–2, then ask the coordinator to rerun freeze-prep-002 before ledger promotion.

This pack does not perform those grants.

## Ledger safety

Did not edit `parity/requirements.json`, `parity/configurations.json`, `parity/progress.md`, `parity/mismatches.json`, `parity/dependencies.json`, `parity/source-lock.json`, or `parity/completion.json`.

At verification time, `acceptanceDefinitionsFrozen` remained false and `acceptanceDefinitionOwner` remained null (read-only probe).

## Reproduce

```sh
shasum -a 256 \
  parity/acceptance/setup-pstack/definitions.json \
  parity/acceptance/setup-pstack/configurations.json
sh parity/research/acceptance-custody-pack-001/verify-custody-pack.sh \
  parity/research/acceptance-custody-pack-001/pack
```

Expected: exit 0 and digests `e5761017…afe5` / `9eea3685…8a4e`.

Mutation check:

```sh
MUT=$(mktemp -d)
cp -R parity/research/acceptance-custody-pack-001/pack "$MUT/pack"
printf x >> "$MUT/pack/definitions.json"
sh parity/research/acceptance-custody-pack-001/verify-custody-pack.sh "$MUT/pack"
# expect non-zero exit
rm -rf "$MUT"
```

## Merge recommendation

Accept the research pack and report. Do not set `acceptanceDefinitionsFrozen`. Keep owner null until the operator completes G3. External custody remains unestablished until the archive leaves the implementation-writable checkout.
