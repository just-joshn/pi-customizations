### Authoring or modifying a skill

**You own the skill's voice.**

1. Use the **create-skill** skill (`/skill:create-skill`) for authoring `SKILL.md` files. Write a new skill to `.pi/skills/`, `${PI_CODING_AGENT_DIR:-~/.pi/agent}/skills`, or the package's `skills/`. Do not copy a packaged skill into a user skills directory; that copy wins over the package and freezes its text.
2. Validate the skill: frontmatter has `name` (matching parent directory, lowercase letters/numbers/hyphens, <= 64 chars) and `description` (<= 1024 chars), referenced files exist, cross-skill links resolve, and `/reload` loads cleanly in Pi with no warnings.
3. Test cases if structural. Skip if subjective.
4. Run **Opening a PR**.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
