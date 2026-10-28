# Architect arena rubric (pi-rea)

Artifact: one design package (usage + type sketch + module map + rationale) for `extensions/pi-rea` that achieves claimable 100% agent-facing parity with rea-agents 6.8.0 on Pi 1.4.0 with zero runtime dependency on rea-agents.

## Criteria

1. **Contract coverage.** Accounts for all 229 tools, 6 prompts, Evidence envelopes, skill, and verify/doctor semantics against the 6.8.0 oracle under `parity/pi-rea/`.
2. **Pi-native depth.** Uses public Pi 1.4.0 mechanisms only; no second agent loop; large catalog stays off the default prompt.
3. **Independence.** No runtime import, spawn, or npx of rea-agents; oracle is verification-only.
4. **Domain structure.** Names the core data shape (session/Evidence/catalog) before logic; fails closed without inventing findings.
5. **Extensibility.** A future maintainer can implement one tool family without rewriting registration or session ownership.
6. **Reuse.** Honest plan for absorbing sibling `/Users/josh-desktop/src/personal/pi-rea/extensions/pi-rea` and main `skills/reverse-engineer-anything` without duplicating skill names.

