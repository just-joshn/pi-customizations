# Acceptance custody pack 001

Operator-handoff bundle for live-98 DRAFT acceptance oracle bytes.

This pack does not freeze. It does not set `acceptanceDefinitionsFrozen`.
It does not name an owner. Same-user checkout is not external custody.

## Layout

| Path | Role |
| --- | --- |
| `pack/definitions.json` | Byte-identical copy of live definitions |
| `pack/configurations.json` | Byte-identical copy of live configurations |
| `pack/MANIFEST.sha256` | Pinned SHA-256 digests |
| `pack/OPERATOR-G3-STEPS.md` | Exact G3 grant steps for the operator |
| `verify-custody-pack.sh` | Re-runnable integrity check |
| `live98-acceptance-custody-pack.tgz` | Immutable archive of `pack/` |

## Expected digests

```text
e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5  definitions.json
9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e  configurations.json
```
