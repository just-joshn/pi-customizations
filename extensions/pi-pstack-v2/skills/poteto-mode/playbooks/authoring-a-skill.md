### Authoring or modifying a skill

**You own the skill's voice.**

1. Use `/create-skill` (Pi's Agent Skills format) to scaffold or update the skill and check it loads with `/skill:<name>`.
2. Validate the skill with `/create-skill validate <path/to/SKILL.md>`: frontmatter has `name` matching its folder and non-empty `description`, referenced files exist, cross-skill links resolve.
3. Test cases if structural. Skip if subjective.
4. Run **Opening a PR**.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
