---
name: create-skill
description: Create or revise a Pi skill (a directory with SKILL.md plus optional scripts, references, and assets). Covers placement, frontmatter, agent-facing writing, a draft-test-iterate loop, and tuning the description so the skill triggers when it should. Use for /create-skill, "write a skill", "turn this workflow into a skill", or editing an existing SKILL.md.
---

# Create a skill

A skill is a directory whose `SKILL.md` holds YAML frontmatter and instructions for an agent. Pi lists a skill's name, description, and path in the system prompt and loads the body only when a task calls for it, or when the user types `/skill:<name>`.

## 1. Decide placement and name

- Project skill: `.pi/skills/<name>/SKILL.md`, or `.agents/skills/<name>/SKILL.md` for other Agent Skills hosts. Commit it with the repo.
- Personal skill: `~/.pi/agent/skills/<name>/SKILL.md` (respect `PI_CODING_AGENT_DIR` when it is set).
- Packaged skill: a `skills/` directory inside a Pi package.
- The name uses lowercase letters, digits, and single hyphens, at most 64 characters, and matches the directory name.
- Before creating a new skill, search the existing skills for one that already covers the job. Extend it instead of adding an overlap.

## 2. Write the frontmatter

```yaml
---
name: verify-checkout
description: Drive the checkout flow in a real browser and capture proof. Use when a change touches cart, payment, or order confirmation.
disable-model-invocation: true
---
```

- `name` and `description` are required. Pi skips a skill without a description.
- `description` is one YAML scalar of at most 1024 characters. Quote it, or use `description: >-` with indented continuation lines, when it contains `: `, a leading special character, or line breaks.
- Write the description as "what it does" plus "when to use it", with the words a user or agent would actually say. It is the only text the model sees before deciding to load the skill.
- Set `disable-model-invocation: true` when the skill should run only on an explicit `/skill:<name>`, for example a workflow with side effects or a personal mode.
- Other Agent Skills fields are `license`, `compatibility`, `metadata` (a key-value map), and `allowed-tools`. Put host-specific fields under `metadata`.

## 3. Write the body for an agent reader

- Start with what the skill produces, then the steps in order. One instruction per sentence.
- Give exact commands, paths, and file names. Use paths relative to the skill directory for bundled files; Pi tells the agent where the skill lives.
- Move long reference material into `references/` and executable helpers into `scripts/`, and say when to read or run each one.
- Encode a rule that must always hold as a script, check, or lint the skill runs. Prose alone is a request, not a guarantee.
- Cut anything the agent already knows. Keep the body short enough to read in full before acting.

## 4. Draft, test, iterate

1. Draft the skill in place.
2. Load it: start Pi where the skill is discoverable, or run `pi --skill <dir>`. Fix every startup diagnostic.
3. Run it on two or three realistic tasks with `/skill:<name> <task>` in a fresh session, for example `pi -p --no-session "/skill:<name> <task>"`. Read what the agent actually did, not its summary.
4. Note each place it skipped a step, guessed, or went off course. Tighten the instruction that allowed it, then rerun the same tasks.
5. Stop when the runs follow the skill without help. Run `/reload` in open sessions after edits.

## 5. Tune the description

Use this loop when a skill exists but does not trigger, or triggers on the wrong requests.

1. Write five prompts that should trigger it and five near misses that should not.
2. For each prompt, run a fresh session with the skill discoverable and check whether the agent read the skill's `SKILL.md`.
3. Rewrite the description to name the missing triggers and to exclude the near misses. Keep it one scalar.
4. Repeat until both sets behave. Skills with `disable-model-invocation: true` never auto-trigger, so this loop does not apply to them.

## 6. Finish

- Reload and confirm the skill loads with no diagnostics.
- Report the path, the frontmatter, what each run showed, and anything left to tune.
