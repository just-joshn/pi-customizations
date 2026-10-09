# G3 acceptance freeze custody (operator only)

This unit does not freeze definitions and does not name an owner.
Default remains parked until you complete every step below.

Clears blocker: `ACCEPTANCE_DEFINITIONS_UNFROZEN` (grant `G3-ACCEPTANCE-FREEZE-CUSTODY`).

Pinned live-98 DRAFT digests (must stay unchanged unless a later regen supersedes):

| Artifact | SHA-256 |
| --- | --- |
| definitions.json | `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5` |
| configurations.json | `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e` |

Supporting verifier write-confinement digest (supporting only, not a freeze grant):
`5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7`.

## Exact grant steps

1. Name an independent owner that is not the implementation parent and not this packing worker. Leave the name unset until that principal exists. Do not invent a name in the ledger from this pack.
2. Place this custody pack (or the measured definition and configuration bytes with matching digests) in an external immutable store the implementation owner cannot write. A same-user checkout is not external custody.
3. Authorize the freeze transition only after steps 1 and 2. Then ask the coordinator to rerun `parity/research/acceptance-freeze-prep-002/` before any ledger promotion of `acceptanceDefinitionsFrozen`.

## Verify the pack before handoff

From the repository root:

```sh
sh parity/research/acceptance-custody-pack-001/verify-custody-pack.sh \
  parity/research/acceptance-custody-pack-001/pack
```

Expect exit 0 and `PASS`.
