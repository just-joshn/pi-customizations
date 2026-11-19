# Coding style (pi-pstack-v2)

Canonical checklist lives in the user Coding Style Rules. This file fills **Project-Specific Style** and is what `scripts/style-audit.mjs` enforces.

## Naming

- Files: kebab-case for multi-word modules (`run-in-tmux.ts`).
- Types: PascalCase. Values/functions: camelCase.
- Test files: `*.test.ts` next to the surface they pin, under `test/` for the extension.

## File structure

- Extension runtime under `src/` by domain (`jobs`, `sandbox`, `credentials`, `subagent`, …).
- Skill CLIs keep their own `scripts/` trees; style rules still apply.
- Every code file is under 800 lines. Prefer 200–400.
- Every function, callbacks included, is under 50 lines.
- Indentation never goes deeper than 4 levels.

## Framework patterns

- **Pi tool parameters:** TypeBox (`Type.Object`, …) only. Do not dual-validate those with zod.
- **All other external input** (JSON files, frontmatter bodies after parse, CLI `argv`, env-derived structured data): zod at the boundary, then trust the inferred type inside.
- Never mutate an object, in tests too. No property or index assignment, no `delete`, no `push`/`splice`/`sort`/`fill`/…, no `Map.set`/`Set.add`/`delete`/`clear`, no `Object.assign` onto an existing object, no `Reflect.set`. Build new values with spread, `map`, `filter`, `reduce`, `toSorted`, `new Map([...])`. Rebinding a local `let` is not object mutation.
- `JSON.parse(...)` and `process.argv` go straight into a zod `.parse`/`.safeParse` call.
- `console.log` is forbidden everywhere. Boundary `catch` may `console.error` then throw a clear `Error`.
- No magic numbers. Name every number other than 0, 1, -1 as a constant, tests included.
- No empty blocks. A `catch` either handles the error or rethrows it.
- Style rules cannot be silenced with `biome-ignore`.

## Gate

`scripts/style-audit.mjs` checks file size, nesting, and suppressions itself. The AST rules run through Biome with `scripts/style/rules.jsonc` and the GritQL plugins `scripts/style/immutability.grit` and `scripts/style/input-validation.grit`.

```bash
node scripts/style-audit.mjs
bun run typecheck
bunx vitest run
```
