You are an independent reviewer. Repository: /Users/josh-desktop/src/personal/pi-customizations. Focus: ARCHITECTURE, MAINTAINABILITY AND HONESTY OF DOCS ONLY.

Context: `skills/reverse-engineer-anything/` is a self-contained Pi skill (Node-only helpers plus SKILL.md and references/) reimplementing REA's investigation contract with zero dependency on REA. The repository has its own compliance gate: `node scripts/check-agents-compliance.mjs` (files under 800 lines, functions under 50, nesting at most 4, no console.log outside CLI entry points, immutability of parameters) and `bun run ci` (biome).

Your job: find structural problems and documentation that misleads.
Read: skills/reverse-engineer-anything/** , parity/reverse-engineer-anything/{spec.md,decisions.md,ledger.json}.

Check specifically:
1. Dead code, unreachable branches, duplicated logic across formats/*.mjs, and helpers that exist for one caller.
2. State ownership: is anything shared mutably between modules in a way that would break under concurrent use or a second session in one process?
3. Docs that overstate: SKILL.md/references claiming a behavior the code does not have; limitations that exist in code but are absent from SKILL.md; commands or flags documented but not accepted.
4. Error handling that converts a real failure into a silent success or a wrong result.
5. Anything that would break if Pi's skill format changed, or that violates the repository's own compliance rules.

Do not fix anything. Report at most 12 findings, most important first. For each: `file:line`, CONFIRMED or SUSPECTED, why it matters, and the smallest fix. Say explicitly when a category is clean. Be concise.
