# Coding style (pi-pstack-v2)

Canonical checklist lives in the user Coding Style Rules. This file fills **Project-Specific Style** and is what `scripts/style-audit.mjs` enforces.

## Naming

- Files: kebab-case for multi-word modules (`run-in-tmux.ts`).
- Types: PascalCase. Values/functions: camelCase.
- Test files: `*.test.ts` next to the surface they pin, under `test/` for the extension.

## File structure

- Extension runtime under `src/` by domain (`jobs`, `sandbox`, `credentials`, `subagent`, …).
- Skill CLIs keep their own `scripts/` trees; style rules still apply.
- Hard max 800 lines per code file. Prefer 200–400.

## Framework patterns

- **Pi tool parameters:** TypeBox (`Type.Object`, …) only. Do not dual-validate those with zod.
- **All other external input** (JSON files, frontmatter bodies after parse, CLI `argv`, env-derived structured data): zod at the boundary, then trust the inferred type inside.
- Prefer returns of new objects/arrays over in-place updates (`toSorted` / spread / map). No `.push` / property assignment on shared or returned structures.
- `console.log` is forbidden in non-test code. Boundary `catch` may `console.error` then throw a clear `Error`.
- Magic numbers (timeouts, limits, uid thresholds) are named constants at module top.

## Gate

```bash
node scripts/style-audit.mjs
bun run typecheck
bunx vitest run
```
