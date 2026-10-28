# Throughput checkpoint: pi-rea

## Blocking first steps

1. Branch `feat/pi-rea-6.8.0` from main (existing `feat/pi-rea` is pinned in another worktree on an old tip).
2. Copy sibling `extensions/pi-rea` into this repo.
3. Pin peer/dev Pi packages to 1.4.0 to match the live CLI.
4. Add contract generator; regenerate `schemas/tool-contracts.json` to 229 tools from `parity/pi-rea/rea-6.8.0-tools-list.json`.
5. Prove: package tests pass; `counts.tools === 229`; `pi -e` loads the extension.

## Independent workstreams (after catalog green)

- Catalog/doctor digests and prompts (6 templates from `rea-6.8.0-prompts.json`)
- Session/Evidence kernel (already in sibling; harden brands/phase)
- Analyzer families (absorb main skill JS/HAR/Go/ZIP; then static inspectors)
- Skill + `/rea` collision warnings
- Parity ledger under `parity/pi-rea/` (port-harness schema, no early VERIFIED for unimplemented)

## Shared mutable state

- `schemas/tool-contracts.json` — only the generator writes it
- `ReaSession` — sequential tool execution; one writer per Pi session
- Skill name `reverse-engineer-anything` — single package copy; delete/redirect standalone after cutover

## Smallest safe decomposition

One owner for the scaffold unit (this checkpoint’s blocking steps). Fan out family implementations only after the 229-catalog load path is green.
