# Phase 1 Discovery — create-skill probe

## Purpose

Teach the agent to echo `CREATE-SKILL-PROBE-MARKER` when the user says "run the create-skill probe".

## Location

Project skill named `parity-create-skill-probe` (repository-scoped, not personal).

## Triggers

- "run the create-skill probe"
- "parity-create-skill-probe"
- "create-skill probe"

## Constraints

- SKILL.md under 80 lines
- No scripts
- Body must include the exact marker `CREATE-SKILL-PROBE-MARKER` on its own line

## Patterns

Follow the create-skill `SKILL.md` structure (YAML frontmatter with `name` / `description`, then markdown body with clear instructions).
