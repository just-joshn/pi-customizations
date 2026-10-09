# u-dep-pi-tarball-sig-001 report

Status: complete. Verdict: close (Pi tarball signature only).

## Outcome

Authenticated `@earendil-works/pi-coding-agent@1.1.0` registry ECDSA signature against published npm v1 keys. Integrity matched locked `registryIntegrity` and local tarball. Merged `signatureAuthenticated: true` on `source-lock.json` `pi` section. Did **not** set `completeDependencyClosure` or flip source-lock `status`.

## Evidence

| Check | Result |
| --- | --- |
| openssl Verified OK | yes |
| integrityMatchedTarball | yes |
| integrityMatchedSourceLock | yes |
| keyid | `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U` |
| tarballSha256 | `09cd8a0a43dbb1d81a67346b09400b439ce71d818caba4e963ea958846a1aed4` |

Artifacts: `parity/research/dep-pi-tarball-sig-001/signature-auth.json`.

## Non-claims

Live integrations, host CU/enterprise edges, acceptance freeze, and the four unverified requirements remain open.
