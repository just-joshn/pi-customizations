---
name: create-skill
description: >-
  Create or revise a Pi skill (a directory with SKILL.md plus optional scripts,
  references, and assets). Covers the requirements interview, placement,
  frontmatter, agent-facing writing, progressive disclosure, common patterns,
  a draft-test-iterate loop, and tuning the description so the skill triggers
  when it should. Use for /create-skill, "write a skill", "turn this workflow
  into a skill", or editing an existing SKILL.md.
---

# Create a skill

A skill is a directory whose `SKILL.md` holds YAML frontmatter and instructions for an agent. Pi lists a skill's name, description, and path in the system prompt and loads the body only when a task calls for it, or when the user types `/skill:<name>`.

## Before you begin: gather requirements

Before creating a skill, gather this from the user:

1. **Purpose and scope.** What specific task or workflow should this skill help with?
2. **Target location.** Personal (`~/.pi/agent/skills/`), project (`.pi/skills/`), or packaged (`skills/` inside a Pi package)?
3. **Trigger scenarios.** When should the agent automatically apply this skill?
4. **Key domain knowledge.** What specialized information does the agent need that it would not already know?
5. **Output format preferences.** Are there specific templates, formats, or styles required?
6. **Existing patterns.** Are there existing examples or conventions to follow?

### Verbatim text from the user

If the user includes exact wording to use in the skill, respect it and use it **verbatim** in `SKILL.md` (same words, same order). Do not paraphrase, soften, or expand their copy, and do not add unrequested headings or commentary around it.

### Inferring from context

If you have previous conversation context, infer the skill from what was discussed. You can create skills based on workflows, patterns, or domain knowledge that emerged in the conversation.

### Gathering additional information

If you need clarification, use the AskQuestion tool when available:

```
Example AskQuestion usage:
- "Where should this skill be stored?" with options like ["Personal (~/.pi/agent/skills/)", "Project (.pi/skills/)"]
- "Should this skill include executable scripts?" with options like ["Yes", "No"]
```

If the AskQuestion tool is not available, ask these questions conversationally.

---

## Skill file structure

### Directory layout

Skills are stored as directories containing a `SKILL.md` file:

```
skill-name/
├── SKILL.md              # Required - main instructions
├── references/           # Optional - detailed documentation the agent reads on demand
│   └── reference.md
├── examples.md           # Optional - usage examples (or under references/)
└── scripts/              # Optional - utility scripts
    ├── validate.py
    └── helper.sh
```

### Storage locations

| Type | Path | Scope |
|------|------|-------|
| Personal | `~/.pi/agent/skills/<name>/` (respect `PI_CODING_AGENT_DIR` when set) | Available in every project on this machine |
| Project | `.pi/skills/<name>/`, or `.agents/skills/<name>/` for other Agent Skills hosts | Shared with anyone using the repository |
| Packaged | `skills/<name>/` inside a Pi package | Ships with the package (`pi install`) |

**IMPORTANT.** Never write personal or project skills into a Pi package's `skills/` tree unless the user is editing that package on purpose. Packaged skills are owned by the package maintainer.

Before creating a new skill, search the existing skills for one that already covers the job. Extend it instead of adding an overlap.

### SKILL.md structure

Every skill requires a `SKILL.md` file with YAML frontmatter and markdown body:

```markdown
---
name: your-skill-name
description: Brief description of what this skill does and when to use it
disable-model-invocation: true
---

# Your skill name

## Instructions
Clear, step-by-step guidance for the agent.

## Examples
Concrete examples of using this skill.
```

Default `disable-model-invocation: true` so the skill only loads when named explicitly (`/skill:<name>` or an explicit handoff). Omit it only when the agent should auto-invoke from ambient context.

### Required metadata fields

| Field | Requirements | Purpose |
|-------|--------------|---------|
| `name` | Max 64 chars, lowercase letters/numbers/hyphens only. Must match the directory name. | Unique identifier for the skill |
| `description` | Max 1024 chars, non-empty. One YAML scalar. | Helps the agent decide when to apply the skill |

`name` and `description` are required. Pi skips a skill without a description.

Quote the description, or use `description: >-` with indented continuation lines, when it contains `: `, a leading special character, or line breaks.

Other Agent Skills fields are `license`, `compatibility`, `metadata` (a key-value map), and `allowed-tools`. Put host-specific fields under `metadata`.

---

## Writing effective descriptions

The description is **critical** for skill discovery. The agent uses it to decide when to apply your skill. It is the only text the model sees before deciding to load the body.

### Description best practices

1. **Write in third person** (the description is injected into the system prompt):
   - Good: "Processes Excel files and generates reports"
   - Avoid: "I can help you process Excel files"
   - Avoid: "You can use this to process Excel files"

2. **Be specific and include trigger terms**:
   - Good: "Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction."
   - Vague: "Helps with documents"

3. **Include both WHAT and WHEN**:
   - WHAT: What the skill does (specific capabilities)
   - WHEN: When the agent should use it (trigger scenarios)

### Description examples

```yaml
# PDF processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.

# Excel analysis
description: Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.

# Git commit helper
description: Generate descriptive commit messages by analyzing git diffs. Use when the user asks for help writing commit messages or reviewing staged changes.

# Code review
description: Review code for quality, security, and best practices following team standards. Use when reviewing pull requests, code changes, or when the user asks for a code review.
```

### Tune the description (trigger loop)

Use this loop when a skill exists but does not trigger, or triggers on the wrong requests.

1. Write five prompts that should trigger it and five near misses that should not.
2. For each prompt, run a fresh session with the skill discoverable and check whether the agent read the skill's `SKILL.md`.
3. Rewrite the description to name the missing triggers and to exclude the near misses. Keep it one scalar.
4. Repeat until both sets behave. Skills with `disable-model-invocation: true` never auto-trigger, so this loop does not apply to them.

---

## Core authoring principles

### 1. Concise is key

The context window is shared with conversation history, other skills, and requests. Every token competes for space.

**Default assumption.** The agent is already very smart. Only add context it does not already have.

Challenge each piece of information:
- "Does the agent really need this explanation?"
- "Can I assume the agent knows this?"
- "Does this paragraph justify its token cost?"

**Good (concise):**
```markdown
## Extract PDF text

Use pdfplumber for text extraction:

\`\`\`python
import pdfplumber

with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
\`\`\`
```

**Bad (verbose):**
```markdown
## Extract PDF text

PDF (Portable Document Format) files are a common file format that contains
text, images, and other content. To extract text from a PDF, you'll need to
use a library. There are many libraries available for PDF processing, but we
recommend pdfplumber because it's easy to use and handles most cases well...
```

### 2. Keep SKILL.md under 500 lines

For optimal performance, the main SKILL.md file should be concise. Use progressive disclosure for detailed content.

### 3. Progressive disclosure

Put essential information in SKILL.md. Put detailed reference material in separate files that the agent reads only when needed.

```markdown
# PDF processing

## Quick start
[Essential instructions here]

## Additional resources
- For complete API details, see \`references/api.md\`
- For usage examples, see \`examples.md\`
```

**Keep references one level deep.** Link directly from SKILL.md to reference files. Deeply nested references may result in partial reads.

Use paths relative to the skill directory for bundled files. Pi tells the agent where the skill lives.

### 4. Set appropriate degrees of freedom

Match specificity to the task's fragility:

| Freedom level | When to use | Example |
|---------------|-------------|---------|
| **High** (text instructions) | Multiple valid approaches, context-dependent | Code review guidelines |
| **Medium** (pseudocode/templates) | Preferred pattern with acceptable variation | Report generation |
| **Low** (specific scripts) | Fragile operations, consistency critical | Database migrations |

### 5. Write the body for an agent reader

- Start with what the skill produces, then the steps in order. One instruction per sentence.
- Give exact commands, paths, and file names.
- Encode a rule that must always hold as a script, check, or lint the skill runs. Prose alone is a request, not a guarantee.
- Cut anything the agent already knows. Keep the body short enough to read in full before acting.

---

## Common patterns

### Template pattern

Provide output format templates:

```markdown
## Report structure

Use this template:

\`\`\`markdown
# [Analysis title]

## Executive summary
[One-paragraph overview of key findings]

## Key findings
- Finding 1 with supporting data
- Finding 2 with supporting data

## Recommendations
1. Specific actionable recommendation
2. Specific actionable recommendation
\`\`\`
```

### Examples pattern

For skills where output quality depends on seeing examples:

```markdown
## Commit message format

**Example 1:**
Input: Added user authentication with JWT tokens
Output:
\`\`\`
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware
\`\`\`

**Example 2:**
Input: Fixed bug where dates displayed incorrectly
Output:
\`\`\`
fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation
\`\`\`
```

### Workflow pattern

Break complex operations into clear steps with checklists:

```markdown
## Form filling workflow

Copy this checklist and track progress:

\`\`\`
Task progress:
- [ ] Step 1: Analyze the form
- [ ] Step 2: Create field mapping
- [ ] Step 3: Validate mapping
- [ ] Step 4: Fill the form
- [ ] Step 5: Verify output
\`\`\`

**Step 1: Analyze the form**
Run: \`python scripts/analyze_form.py input.pdf\`
...
```

### Conditional workflow pattern

Guide through decision points:

```markdown
## Document modification workflow

1. Determine the modification type:

   **Creating new content?** Follow "Creation workflow" below.
   **Editing existing content?** Follow "Editing workflow" below.

2. Creation workflow:
   - Use docx-js library
   - Build document from scratch
   ...
```

### Feedback loop pattern

For quality-critical tasks, implement validation loops:

```markdown
## Document editing process

1. Make your edits
2. **Validate immediately**: \`python scripts/validate.py output/\`
3. If validation fails:
   - Review the error message
   - Fix the issues
   - Run validation again
4. **Only proceed when validation passes**
```

---

## Utility scripts

Pre-made scripts offer advantages over generated code:
- More reliable than generated code
- Save tokens (no code in context)
- Save time (no code generation)
- Ensure consistency across uses

```markdown
## Utility scripts

**analyze_form.py**: Extract all form fields from PDF
\`\`\`bash
python scripts/analyze_form.py input.pdf > fields.json
\`\`\`

**validate.py**: Check for errors
\`\`\`bash
python scripts/validate.py fields.json
# Returns: "OK" or lists conflicts
\`\`\`
```

Make clear whether the agent should **execute** the script (most common) or **read** it as reference. Prefer `bash` for running scripts. Prefer `read`, `grep`, and `find` when inspecting skill files.

---

## Anti-patterns to avoid

### 1. Windows-style paths
- Use: `scripts/helper.py`
- Avoid: `scripts\helper.py`

### 2. Too many options
```markdown
# Bad - confusing
"You can use pypdf, or pdfplumber, or PyMuPDF, or..."

# Good - provide a default with escape hatch
"Use pdfplumber for text extraction.
For scanned PDFs requiring OCR, use pdf2image with pytesseract instead."
```

### 3. Time-sensitive information
```markdown
# Bad - will become outdated
"If you're doing this before August 2025, use the old API."

# Good - use an "old patterns" section
## Current method
Use the v2 API endpoint.

## Old patterns (deprecated)
<details>
<summary>Legacy v1 API</summary>
...
</details>
```

### 4. Inconsistent terminology
Choose one term and use it throughout:
- Always "API endpoint" (not mixing "URL", "route", "path")
- Always "field" (not mixing "box", "element", "control")

### 5. Vague skill names
- Good: `processing-pdfs`, `analyzing-spreadsheets`
- Avoid: `helper`, `utils`, `tools`

---

## Skill creation workflow

When helping a user create a skill, follow this process.

### Phase 1: Discovery

Gather information about:
1. The skill's purpose and primary use case
2. Storage location (personal vs project vs packaged)
3. Trigger scenarios
4. Any specific requirements or constraints
5. Existing examples or patterns to follow

If you have access to the AskQuestion tool, use it for efficient structured gathering. Otherwise, ask conversationally.

### Phase 2: Design

1. Draft the skill name (lowercase, hyphens, max 64 chars, matches directory)
2. Write a specific, third-person description
3. Outline the main sections needed
4. Identify if supporting files or scripts are needed

### Phase 3: Implementation

1. Create the directory structure
2. Write the SKILL.md file with frontmatter (`write` for new files, `edit` for revisions)
3. Create any supporting reference files
4. Create any utility scripts if needed

### Phase 4: Draft, test, iterate

1. Draft the skill in place.
2. Load it: start Pi where the skill is discoverable, or run `pi --skill <dir>`. Fix every startup diagnostic.
3. Run it on two or three realistic tasks with `/skill:<name> <task>` in a fresh session, for example `pi -p --no-session "/skill:<name> <task>"`. Read what the agent actually did, not its summary.
4. Note each place it skipped a step, guessed, or went off course. Tighten the instruction that allowed it, then rerun the same tasks.
5. Stop when the runs follow the skill without help. Run `/reload` in open sessions after edits.

### Phase 5: Verification

1. Verify the SKILL.md is under 500 lines
2. Check that the description is specific and includes trigger terms
3. Ensure consistent terminology throughout
4. Verify all file references are one level deep
5. Confirm the skill loads with no diagnostics after `/reload`
6. Report the path, the frontmatter, what each run showed, and anything left to tune

---

## Complete example

Here's a complete example of a well-structured skill:

**Directory structure:**
```
code-review/
├── SKILL.md
├── references/
│   └── STANDARDS.md
└── examples.md
```

**SKILL.md:**
```markdown
---
name: code-review
description: Review code for quality, security, and maintainability following team standards. Use when reviewing pull requests, examining code changes, or when the user asks for a code review.
---

# Code review

## Quick start

When reviewing code:

1. Check for correctness and potential bugs
2. Verify security best practices
3. Assess code readability and maintainability
4. Ensure tests are adequate

## Review checklist

- [ ] Logic is correct and handles edge cases
- [ ] No security vulnerabilities (SQL injection, XSS, etc.)
- [ ] Code follows project style conventions
- [ ] Functions are appropriately sized and focused
- [ ] Error handling is comprehensive
- [ ] Tests cover the changes

## Providing feedback

Format feedback as:
- **Critical**: Must fix before merge
- **Suggestion**: Consider improving
- **Nice to have**: Optional enhancement

## Additional resources

- For detailed coding standards, see \`references/STANDARDS.md\`
- For example reviews, see \`examples.md\`
```

---

## Summary checklist

Before finalizing a skill, verify:

### Core quality
- [ ] Description is specific and includes key terms
- [ ] Description includes both WHAT and WHEN
- [ ] Written in third person
- [ ] SKILL.md body is under 500 lines
- [ ] Consistent terminology throughout
- [ ] Examples are concrete, not abstract

### Structure
- [ ] File references are one level deep
- [ ] Progressive disclosure used appropriately
- [ ] Workflows have clear steps
- [ ] No time-sensitive information
- [ ] Placement is personal, project, or packaged as intended

### If including scripts
- [ ] Scripts solve problems rather than punt
- [ ] Required packages are documented
- [ ] Error handling is explicit and helpful
- [ ] No Windows-style paths
