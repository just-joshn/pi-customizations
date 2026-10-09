# Commander 14.0.0 independent closure audit

throughput checkpoint: n/a, read-only investigation

## Overview

Independent custody and closure audit of locked `npm:commander@14.0.0`. Re-hashed the captured tarball, all 14 inventory files, both consumers, and registry metadata. Enumerated transitive third-party runtime dependencies (none). Authenticated the registry package signature against published npm v1 keys with openssl. Proposes `closureAudited: true` and `signatureAuthenticated: true` for coordinator merge. Does not claim `completeDependencyClosure`.

## Key concepts

**Closure audited (node / externalDependency).** The locked package body and its declared consumers were re-verified. Transitive third-party npm runtime dependencies were shown absent. Separate Bun runtime binding remains a different edge.

**Signature authenticated.** Registry metadata already carried an ECDSA signature and keyid. Authentication means verifying that signature with the matching key from `https://registry.npmjs.org/-/npm/v1/keys`, and confirming the signed integrity string matches the local tarball. Presence of `dist.signatures` alone is not authentication.

**Not closed here.** Live integrations, host computer-use and enterprise edges, source-lock `status`, and `completeDependencyClosure` stay open.

## How it works

1. `verify_hashes.py` compares `shasum -a 256` of the tarball, unpacked package files, consumers under `parity/reference/cursor-plugins/`, and metadata files to `parity/research/npm/commander-14.0.0/read-inventory.json`. Result `VERIFIED`. Inventory sha256 `19bfb53788883180ca7fd295b1b0c7261da478ed9b0971423cf2791906b90653`.
2. `enumerate_runtime_deps.py` reads `package.json` dependency fields (all absent for runtime) and scans distributed JS/MJS `require` / `import`/`export from` edges. Only relative package modules and `node:*` builtins appear. Third-party runtime count is 0.
3. `verify_npm_signature.py` loads the registry snapshot signature (`keyid` `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`), loads the matching public key from a fresh `npm-v1-keys.json` fetch, builds message `commander@14.0.0:<integrity>`, and runs `openssl dgst -sha256 -verify`. Result `Verified OK`. Tarball sha512 matches the signed integrity. Signature was not invented.

## Where things live

| Artifact | Path |
| --- | --- |
| Locked tarball | `parity/reference/npm/commander-14.0.0/package.tgz` |
| Unpacked package | `parity/reference/npm/commander-14.0.0/unpacked/package/` |
| Prior inventory | `parity/research/npm/commander-14.0.0/read-inventory.json` |
| Consumers | `parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/orch/orch.ts`, `.../watch-pr/cli.ts` |
| This audit | `parity/research/dep-commander-closure-001/` |
| Merge proposal | `parity/research/dep-commander-closure-001/merge-proposal.json` |

## Gotchas

- Graph-level `parity/dependencies.json` `closureAudited` is already true from `u-dep-audit-001`. This unit addresses the still-false node and source-lock externalDependency flags for commander only.
- Commander still depends on Bun/Node platform builtins. The existing edge to `source-bun-runtime` is out of scope for this package-body closure flip.
- Registry snapshot has no `attestations` object. Signature authentication succeeded without SLSA provenance.
- Prior `integrity.json` still records `signatureAuthenticated: false`. Only the coordinator should flip that after merge.

## Disposition

| Flag | Proposal | Evidence |
| --- | --- | --- |
| `closureAudited` (node + source-lock externalDependency) | `true` | hash VERIFIED, 0 third-party runtime deps, consumers re-hashed |
| `signatureAuthenticated` | `true` | openssl Verified OK against npm v1 keys |
| `completeDependencyClosure` | leave `false` | explicit non-claim |
