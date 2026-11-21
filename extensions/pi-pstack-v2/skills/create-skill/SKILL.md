---
name: create-skill
description: Author or validate a Pi Agent Skill with valid YAML frontmatter, progressive disclosure, and resolved local links. Use via /create-skill <goal> or /create-skill validate <path>.
disable-model-invocation: true
---

# Create skill

Author a Pi Agent Skill that conforms to the Agent Skills format and loads cleanly with `/skill:<name>`.

## Steps

1. Pick the destination folder:
   - Project skill: `.pi/skills/<skill-name>/SKILL.md`
   - Personal skill: `~/.pi/agent/skills/<skill-name>/SKILL.md`
   - Package skill: `skills/<skill-name>/SKILL.md`
   Use lowercase kebab-case for `<skill-name>` and match the frontmatter `name` field to the directory name.
2. Write `SKILL.md` with YAML frontmatter containing `name`, `description` (clear trigger + purpose), and `disable-model-invocation: true` when the skill should only run on explicit invocation.
3. Keep the body concise and actionable. Put bulky reference material in `references/<topic>.md` and scripts in `scripts/`, linked with relative paths.
4. Validate the skill with `/create-skill validate <path/to/SKILL.md>` and confirm zero errors (frontmatter `name`, directory match, non-empty `description`, and all relative links resolve).
5. When editing an existing skill, keep prose tight and run `/skill:unslop` on the result.
