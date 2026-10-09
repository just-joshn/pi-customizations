# Independent dependency closure audit

Audit status: `AUDITED_INCOMPLETE`

Audit unit: `u-dep-audit-001`

Ledger snapshot: 2026-10-08

## Verdict

The independent recursive audit was completed. The audit does not establish complete dependency closure.

The coordinator may set `parity/dependencies.json` `closureAudited` to `true` and record this file as the evidence path. The coordinator must keep `parity/source-lock.json` `cursorPlugins.completeDependencyClosure` false. The source lock must remain incomplete. All eight unresolved edges and all eleven unresolved references must remain active.

This interpretation matches the completion gate. `parity/scripts/completion.mjs` checks the audit marker, unresolved references, unresolved edges, and source closure as separate conditions. Setting the audit marker records that the independent audit occurred. It does not make the other conditions pass.

## Ledger census

| Check | Observed result |
| --- | --- |
| Dependency nodes | 34 |
| Nodes with `readingComplete: true` | 34 |
| Nodes with `dependenciesEnumerated: false` | 8 |
| Dependency edges | 34 |
| Resolved edges | 26 |
| Unresolved or unverified edges | 8 |
| Unresolved references | 11 |
| Current `closureAudited` | false |
| Current `completeDependencyClosure` | false |

The eight nodes without complete dependency enumeration are:

- `cursor-self-hosted-computer-use`
- `cursor-enterprise-integration-policy`
- `cursor-team-kit`
- `cursor-cli-host`
- `cursor-create-skill`
- `source-tools-bootstrap`
- `source-tools-manifest`
- `source-bun-runtime`

## Hash audit

The wave 001 verifier re-hashed 40 recorded source entries and returned `VERIFIED`.

The wave 002 verifier re-hashed 66 recorded source entries and returned `VERIFIED`.

The direct audit sample re-hashed ten files across host contracts, the built-in skill capture, the Bun lock, package metadata, TypeScript artifacts, Bun evidence, and the Commander tarball. Every digest matched `sample-sha256.txt`.

The sample covers both closure waves and both resolved and unresolved dispositions. It includes these node classes:

- Host-service contracts.
- A host built-in resource.
- A runtime lock and runtime capture.
- A pure TypeScript package.
- A platform-specific optional package.
- The Commander runtime package.

## Node disposition review

| Node or group | Evidence reviewed | Audit disposition |
| --- | --- | --- |
| `cursor-cli-host` | Wave 001 CLI Markdown hashes and quotes | `readingComplete` is supported for the public documentation set. Dependency enumeration remains incomplete. |
| `cursor-create-skill` | Exact captured `SKILL.md` and Wave 001 inventory | The captured resource hash is supported. Subordinate workflow journeys remain open. |
| `npm:bun-types@1.3.14` | Lock, registry metadata, and unpacked `package.json` | The recorded package dependency on `@types/node` is supported. |
| `npm:typescript@7.0.2` | Tarball, package metadata, lock, and 416-file inventory | The distribution was inventoried. The ledger's unresolved semantic per-file audit remains valid. |
| `@typescript/*` platform packages | Wave 001 and Wave 002 package metadata and inventories | The optional package edges are supported as lock and package relationships. Runtime activation across every platform remains unverified. |
| `source-bun-runtime` | Launcher, bootstrap source, local Bun capture, and official install page | Bun use is supported. An exact runtime version pin and Node built-in compatibility remain unresolved. |
| `npm:commander@14.0.0` | Locked package evidence and tarball hash | Package custody is supported. Compatibility with the unpinned Bun runtime remains unresolved. |

`readingComplete` is not equivalent to semantic or runtime closure in this ledger. The TypeScript node is the clearest example. Its file inventory is complete while its semantic per-file contract audit remains listed as unresolved.

## Edge disposition review

The following eight edges remain unresolved or unverified. Their current dispositions are supportable:

| Edge | Status | Audit disposition |
| --- | --- | --- |
| `cursor-cli-host` to `cursor-self-hosted-computer-use` | unresolved | Keep open. Public documentation does not prove helper, desktop-service, or sharing-transport behavior. |
| `cursor-cli-host` to `cursor-enterprise-integration-policy` | unresolved | Keep open. Public documentation does not prove live policy enforcement or CLI applicability. |
| `cursor-pstack` to `cursor-team-kit` | unverified | Keep open. Distribution custody exists, but complete source and journey closure is not shown. |
| `cursor-pstack` to `cursor-cli-host` | unverified | Keep open. The persistent-mode editor and later-turn behavior still need paired runtime evidence. |
| `cursor-pstack` to `source-tools-bootstrap` | unresolved | Keep open. The launcher establishes a source relationship, but installed lifecycle parity remains unverified. |
| `source-tools-bootstrap` to `source-tools-manifest` | unresolved | Keep open. Activation scope and candidate lifecycle behavior remain unverified. |
| `source-tools-manifest` to `npm:commander@14.0.0` | unresolved | Keep open. The manifest establishes the package relationship, but runtime consumer binding remains incomplete. |
| `npm:commander@14.0.0` to `source-bun-runtime` | unresolved | Keep open. No exact Bun pin or Node compatibility proof closes this edge. |

Resolved-edge samples were also reviewed. The create-skill capture, Bun launcher use, `bun-types` to `@types/node`, `@types/node` to `undici-types`, and TypeScript platform-package relationships have evidence that supports their graph relationships. Their notes correctly preserve runtime and journey gaps.

## Structural finding

Every dependency declared by a node has a matching edge. One edge has no matching declaration in its source node:

`cursor-pstack` to `source-tools-bootstrap`

The coordinator should reconcile this graph asymmetry in a later ledger-owned change. It does not justify removing the edge or clearing any closure blocker.

## Custody and limits

This worker did not implement either closure wave and did not edit the ledgers. The audit used the current ledger files and the wave artifacts as inputs.

The audit did not repeat every network retrieval. It re-hashed the retained artifacts. The existing wave verifiers covered all recorded source entries. The independent direct sample covered ten artifacts chosen across source classes and closure outcomes.

## Reproduction

Run from the repository root:

```bash
python3 parity/research/dep-closure-wave-001/verify_inventory_shasum.py
python3 parity/research/dep-closure-wave-002/verify_inventory_shasum.py
shasum -a 256 -c parity/research/dep-audit-001/sample-sha256.txt
```

Expected final lines:

```text
VERIFIED
VERIFIED
parity/reference/npm/commander-14.0.0/package.tgz: OK
```
