# Skill Design: parity-create-skill-probe

## Skill name

`parity-create-skill-probe`

## Description (third person)

Echoes the marker `CREATE-SKILL-PROBE-MARKER` when the user asks to run the create-skill probe. Use when the user says "run the create-skill probe", or mentions "create-skill probe" or "parity-create-skill-probe".

## Location

Project skill path: `.cursor/skills/parity-create-skill-probe/SKILL.md`

## Main section outline

1. **Frontmatter** — `name` and third-person `description` with trigger terms (create-skill pattern)
2. **Title** — short skill heading
3. **Instructions** — on trigger, reply with `CREATE-SKILL-PROBE-MARKER` on its own line; keep body concise; stay under 80 lines

## Supporting files / scripts

**No.** Single `SKILL.md` only; no reference docs, examples, or scripts.

## Constraints (from requirements)

- Under 80 lines
- No supporting files or scripts
- Marker on its own line
- Patterns: create-skill frontmatter + concise body
