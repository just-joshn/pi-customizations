# Report: Bun runtime pin terminal disposition

## Status

VERDICT `absent-in-source`. Merge payload ready for coordinator. Ledgers not edited. No commit. No invented `engines` / `packageManager` / `.bun-version`.

## Overview

`source-bun-runtime` needs an official Bun binary version pin in locked poteto-mode tools custody, or an honest close that the source declares none. Waves 004 through 009 left the line `unresolved` while proving the same empty candidate set. This unit terminals that evidence as `absent-in-source` instead of inventing a pin from host bun, mise, or bun-types.

## Key concepts

- An official pin is a source declaration under poteto-mode tools (or an equivalent lock binding for the Bun binary), such as `engines.bun`, `packageManager`, `volta`, `devEngines`, `.bun-version`, `bunfig.toml`, `mise.toml`, or `.tool-versions`.
- `#!/usr/bin/env bun` shebangs select an interpreter. They do not pin a version.
- Host `bun --version` (here `1.4.2` under mise `latest`) and `bun-types: latest` are environment or type-package facts. They are not runtime pins.

## How it works

Rerunnable lever `parity/research/dep-bun-pin-terminal-001/probe_bun_pin.py` re-probes package.json fields, walks pin-file names under reference custody and the extensions mirror, records shebangs, checks lock candidates, re-fetches Bun install/lockfile/bunfig docs (legacy bun-version guide still 404), and writes capture plus merge payload.

Double-run VERIFY kept capture sha256 `7d9c41e3c5519fe6b8473a119f427b7ac444235189cf7762e9ad7c4f5a2c9f97`. Doc body hashes match wave-009.

## Where things live

| Artifact | Path |
| --- | --- |
| Probe lever | `parity/research/dep-bun-pin-terminal-001/probe_bun_pin.py` |
| Capture | `parity/research/dep-bun-pin-terminal-001/bun/official-capture.json` |
| Node note | `parity/research/dep-bun-pin-terminal-001/nodes/bun-pin.md` |
| Merge payload | `parity/research/dep-bun-pin-terminal-001/merge-payload.json` |
| Hash verify | `parity/research/dep-bun-pin-terminal-001/verify-hashes.json` |
| Reference package.json | `parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/package.json` (sha256 `d1f815091209d49763775cc188e8e06ff32d5fec648bffd2272bc25a165e87c3`) |

## Acceptance checks

| Check | Result |
| --- | --- |
| Clear verdict pin-found or absent-in-source | `absent-in-source` |
| Exhaustive candidate list + hashes | 36 candidates in capture (`exhaustiveCandidateList`); `pinFilesFound` empty |
| Merge payload if closing absent-in-source | Ready at `merge-payload.json` (`mergePayloadReady: true`) |
| Host bun / mise / bun-types not treated as pins | Explicit `nonPinsExplicit.statement` in capture |
| No ledger edits | Confirmed in unit SCOPE |

## Gotchas

- Closing as `absent-in-source` removes the Bun pin unresolvedReference. It does not set `completeDependencyClosure` true. Other blockers remain.
- Do not invent a pin file or engines field to force `pin-found`.
- Shebang hits (4 under poteto-mode) stay non-pins.

## Merge payload summary

Coordinator apply (worker does not edit ledgers):

1. Update node `source-bun-runtime` evidence/disposition from terminal capture (`pinStatus: absent-in-source`).
2. Remove wave-009 Bun pin string from `unresolvedReferences` (`removeIfPresent` in payload).
3. Keep `completeDependencyClosure` false.

Full JSON: `parity/research/dep-bun-pin-terminal-001/merge-payload.json`.

## Non-pins (explicit)

Host bun `1.4.2`, mise `latest` path `/Users/josh-desktop/.local/share/mise/installs/bun/latest/bin/bun`, and `bun-types: latest` are not pins. They must not be written into `engines`, `packageManager`, or `.bun-version`.

## Verify command

```bash
python3 parity/research/dep-bun-pin-terminal-001/probe_bun_pin.py
shasum -a 256 parity/research/dep-bun-pin-terminal-001/bun/*.html \
  parity/research/dep-bun-pin-terminal-001/bun/bun-version.txt \
  parity/research/dep-bun-pin-terminal-001/bun/official-capture.json
```
