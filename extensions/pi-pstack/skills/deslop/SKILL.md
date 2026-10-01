---
name: deslop
description: Remove AI-generated code slop and clean up code style
---

# Remove AI code slop

Find the pull request's actual base branch from forge metadata or the task brief. For a stacked pull request, use its direct parent branch. For non-PR work, use the task's named comparison base. Review only changes introduced by this branch; if the scope is unknown, report it and do not edit outside the known diff. Never default to `main` when it is not the base.

## Focus Areas

- Extra comments that are unnecessary or inconsistent with local style, except comments that document invariants, constraints, security, compatibility, or user intent
- Defensive checks or try/catch blocks that are abnormal for trusted code paths
- Casts to `any` used only to bypass type issues
- Deeply nested code that should be simplified with early returns
- Other patterns inconsistent with the file and surrounding codebase

## Guardrails

- Keep behavior unchanged unless fixing a clear bug.
- Preserve all comments that document constraints, invariants, security, compatibility, or user intent. Do not delete or rewrite them.
- Prefer minimal, focused edits over broad rewrites.
- Keep the final summary concise (1-3 sentences) and end it with a receipt of files touched and edits per focus area, for example `3 files; comments 4, defensive checks 1, any casts 0, nesting 2, other 0`.
