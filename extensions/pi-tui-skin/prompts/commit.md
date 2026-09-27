---
description: Stage and commit current changes with a conventional message
argument-hint: "[commit message hint]"
---
Commit the current changes.

1. Run `git status --porcelain` and `git diff` (plus `git diff --cached` for anything already staged) to understand what changed. If there are no changes, say so and stop.
2. Stage the relevant files with `git add`. Do not stage unrelated or generated files.
3. Write a conventional commit message: `type(scope): summary` in imperative mood under 72 characters, with a short body explaining the why when the diff is not self-evident.
4. Commit. Never push.

Commit message hint from the user, if any: ${@:-none}

Report the commit hash and a one-line summary of what landed.
