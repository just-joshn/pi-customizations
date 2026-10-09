# Design: parity-create-skill-probe

## Skill name
`parity-create-skill-probe` (project skill at `.pi/skills/parity-create-skill-probe/SKILL.md`)

## Frontmatter
```yaml
---
name: parity-create-skill-probe
description: Echoes the CREATE-SKILL-PROBE-MARKER line for parity checks. Use when the user says "run the create-skill probe", mentions "create-skill probe", or names "parity-create-skill-probe".
disable-model-invocation: true
---
```
Description is third person, with WHAT and WHEN, trigger terms included.

## Main section outline
1. `# Parity Create-Skill Probe` - one-line purpose.
2. `## Instructions` - when the user says "run the create-skill probe", reply with the marker on its own line and nothing else required.
3. `## Output` - exact marker line: `CREATE-SKILL-PROBE-MARKER`, alone on its line.

Constraints: under 80 lines total (target ~15), concise.

## Supporting files / scripts
Needed: **no**. SKILL.md only; no reference.md, examples.md, or scripts/.
