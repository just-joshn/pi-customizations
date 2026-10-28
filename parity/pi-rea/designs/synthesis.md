# Architect synthesis: pi-rea

## Base

**Candidate A** (`parity/pi-rea/designs/candidate-a/`). Native `pi.registerTool` × 229, kernel `direct` / rest `deferred`, one skill, six Pi prompt templates, absorb sibling scaffold + main skill analyzers. Cross-judge total 30/30; parent agreement.

## Grafted from B

- Branded ids and `SessionPhase` exclusivity
- `ToolOutcome` sum before Pi encoding
- Concrete `kernel-manifest` seed from B’s `KERNEL_TOOL_EXPOSURE`
- Richer `binary_session` catalog digests for doctor (native names, not `mcp__rea__*`)
- Prompt contracts from `parity/pi-rea/rea-6.8.0-prompts.json` as Pi prompt templates
- Status warning when a conflicting REA skill/package registration is present

## Grafted from C

- Contract generator as the only catalog lever (edit contract → regen; never hand-edit generated registration)
- Content-addressed retain / `repeat_count` when absorbing `.rea` store semantics under `ReaSession` export
- `AvailabilityCode` vocabulary for fail-closed reasons
- ≤3-file tool hit path (register → dispatch → family)
- Promote-then-delete of `skills/reverse-engineer-anything/scripts` into `extensions/pi-rea/src/analysis/`

## Rejected

- B’s MCP stdio child and `mcp__rea__*` agent-facing names
- C’s CLI-as-required dual public API and divergent Evidence enums
- Activating all 229 as `direct`
- Any runtime `rea-agents` dependency
- Claiming 100% behavioral parity while most tools remain `capability_unavailable`

## First implementation step

Copy sibling `/Users/josh-desktop/src/personal/pi-rea/extensions/pi-rea` into this repo’s `extensions/pi-rea`, add `scripts/generate-contracts` + `kernel-manifest.json`, regenerate `schemas/tool-contracts.json` so `counts.tools === 229`, then run package tests and a Pi load check.
