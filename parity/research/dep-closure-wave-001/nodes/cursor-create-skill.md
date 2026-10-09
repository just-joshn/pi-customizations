# cursor-create-skill

Previously incomplete: True

## Disposition

Exact local distributed resource found at ~/.cursor/skills-cursor/create-skill/SKILL.md for CLI 2026.10.01-e373342 working install. Full SKILL.md body read and copied into owned research path. Subordinate workflows inside the skill body are recorded; no independent audit of every nested instruction against live journeys.

proposeReadingComplete: True
proposeDependenciesEnumerated: False

## Sources

- `parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md` sha256=`255a3d3be7bac8984a13279f754f091a1de6f72c82bdf73e6b3c868e77e7ee82` bytes=15034
  - frontmatter lines 1-8:
```
---
name: create-skill
description: >-
  Create Cursor Agent Skills. Use when authoring a new skill or asking about
  SKILL.md structure.
---
# Creating Skills in Cursor

```
  - lines 20-35:
```
6. **Existing patterns**: Are there existing examples or conventions to follow?

### Verbatim text from the user

If the user includes exact wording to use in the skill, respect it and use it **verbatim** in `SKILL.md` (same words, same order). Do not paraphrase, soften, or expand their copy, and do not add unrequested headings or commentary around it.

### Inferring from Context

If you have previous conversation context, infer the skill from what was discussed. You can create skills based on workflows, patterns, or domain knowledge that emerged in the conversation.

### Gathering Additional Information

If you need clarification, use the AskQuestion tool when available:

```
Example AskQuestion usage:
```
- `parity/reference/cursor-docs/skills.md` sha256=`5ccb25304f16e82a7f58c0241a0a16a072adb33f7697e43c5704c46738e002ac` bytes=17995
  - built-in table create-skill row:
```
| `/create-skill`           | Creates Agent Skills, including their structure and `SKILL.md` files.                                |
```
