# Unit report: create-skill depth (gap-list item 3)

**Goal.** Close soft-dep depth gap so Pi `/create-skill` matches Cursor builtin interview depth, structure rules, description tuning, and draft-test loop, in Pi vocabulary only.

**Does not claim.** Full package parity acceptance.

## Change

Expanded `extensions/pi-pstack/skills/create-skill/SKILL.md` in place (no `references/` split). Kept `name: create-skill` and a strong multi-line `description`.

| Metric | Before | After | Cursor builtin |
| --- | --- | --- | --- |
| Bytes | 4248 | 17633 | 15034 |
| Lines | ~63 | 548 | 508 |

## Sections added or deepened (Pi terms)

| Section | Source coverage |
| --- | --- |
| Before you begin: gather requirements (6 interview items) | Builtin interview |
| Verbatim text from the user | Builtin |
| Inferring from context | Builtin |
| Gathering additional information (AskQuestion) | Builtin, Pi paths in options |
| Skill file structure / directory layout | Builtin + Pi `references/` |
| Storage locations (personal / project / packaged) | Builtin Agent Store → `~/.pi/agent/skills/`, project → `.pi/skills/` |
| SKILL.md structure + required metadata | Builtin + Pi frontmatter notes |
| Writing effective descriptions + examples | Builtin |
| Tune the description (trigger loop) | Prior Pi content, retained |
| Core authoring principles (concise, 500 lines, progressive disclosure, degrees of freedom, agent reader) | Builtin + prior Pi body rules |
| Common patterns (template, examples, workflow, conditional, feedback) | Builtin |
| Utility scripts (`bash` / `read` / `grep` / `find`) | Builtin tools → design.md vocab |
| Anti-patterns | Builtin |
| Skill creation workflow phases 1–5 (Discovery through Verification, with draft-test-iterate) | Builtin phases + prior Pi draft/test loop |
| Complete example + summary checklist | Builtin (emoji severity markers dropped; illustrative links as backtick paths so RES-007 stays green) |

## Forbidden host terms

`rg` for `~/.cursor`, `.cursor/`, `Agent Store`, `/add-plugin`, `skills-cursor`, `\bCursor\b` in the skill file: **no matches**.

RES-012 in `test/resources.test.ts` also scans this file with the package host-term regex.

## Test

Command (from `extensions/pi-pstack`):

```text
bun run test test/resources.test.ts
```

Result (2026-10-31):

```text
Test Files  1 passed (1)
     Tests  14 passed (14)
```

New assertion: `create-skill covers builtin interview depth in Pi terms (gap-list item 3)` checks required headings, Pi placement paths, host-term absence, and size > 12 KiB.

## Principles applied

- **Laziness Protocol.** One-file expand, no unrelated skill rewrites, no `references/` split.
- **Prove It Works.** Size/rg checks plus `resources.test.ts` against the real artifact.
- **Sequence Work into Verifiable Units.** Edit → link-check fix → test → report.
