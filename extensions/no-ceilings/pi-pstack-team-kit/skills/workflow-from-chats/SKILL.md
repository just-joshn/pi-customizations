---
name: workflow-from-chats
description: Extract durable working preferences from recent Pi sessions and convert them into skills, rules, or workflow docs. Use when asked to learn preferences, mine feedback, personalize workflows, or generate team/person-specific agent guidance.
---

# Workflow From Chats

Infer durable working preferences from recent chats. Do not summarize chats; extract reusable workflow guidance.

## Scope

- Default to the last 7 days unless the user asks for a different window.
- Read main session transcripts in `${PI_CODING_AGENT_DIR:-~/.pi/agent}/sessions/--<slug>--/*.jsonl`, where `<slug>` is the cwd with the leading slash dropped and each `/`, `\`, or `:` turned into `-`, or directly in the directory named by `PI_CODING_AGENT_SESSION_DIR`, the `sessionDir` setting, or `--session-dir`, with no `--<slug>--` level. A `task` subagent's transcript is saved under the main session's `subagents/` directory, and its report also appears as the `task` tool result in the main session. Read the main transcripts and each relevant subagent transcript. Use subagent content as evidence, but cite only main session transcripts.
- Do not expose local transcript paths, secrets, customer data, private chat content, or credentials.

## Workflow

1. State the target workflow or preference surface in one paragraph.
2. Build an internal transcript inventory: title/topic, session ID, approximate date, completion state, relevant workers, and why it may contain preference evidence.
3. Scan for explicit preferences, corrections, and workflow markers such as "I prefer", "always", "never", "not what I asked", "stop", "review", "PR", "CI", "logs", and "skill".
4. Extract preference atoms: trigger, workflow step, decision rule, quality bar, stop condition, evidence, and confidence.
5. Rate confidence as strong, medium, weak, or contradicted.
6. Cluster by workflow shape rather than transcript: shipping, review, simplification, debugging, capture, communication, delegation, or validation.
7. Choose the artifact: new skill, skill edit, rule, workflow doc, or no artifact.
8. Draft only the reusable guidance. Filter anecdotes that will not help future tasks.

## Confidence

- Strong: explicit user preference, workflow-changing correction, repeated main-session pattern, or direct request to encode behavior.
- Medium: accepted workflow, repeated tool/model/validation preference, or worker consensus that the main session used successfully.
- Weak: agent-chosen behavior with no user feedback, one ambiguous transcript, or a likely task-specific correction.
- Contradicted: evidence points in incompatible directions; ask the user before writing files.

## Artifact Choice

- Skill: recurring multi-step workflow with clear triggers.
- Rule: general behavior that should apply broadly, as an `AGENTS.md` entry.
- Workflow doc: useful context that is not reliably triggerable.
- No artifact: situational, stale, or low-confidence observation.

## Output

Return a concise synthesis first:

- Target workflow.
- Evidence corpus with main session citations only.
- Preference profile.
- Adopt, consider, dismissed.
- Proposed artifacts.
- Open questions only if they block writing.
