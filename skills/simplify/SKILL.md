---
name: simplify
description: "Review the changed code (working tree, branch diff, PR, or a named path) for reuse, simplification, efficiency, and altitude cleanups with four parallel reviewers, then apply the fixes without changing behavior. Quality only; it does not hunt for correctness bugs. Use when the user asks to simplify, clean up, tidy, or polish a diff or recent changes, or runs /skill:simplify."
license: MIT
---

# Simplify

`/skill:simplify [target]` -> 4 cleanup reviewers in parallel -> apply the fixes.

You are improving the quality of the changed code, not hunting for bugs.
Review it for reuse, simplification, efficiency, and altitude issues, then
fix what you find. Do not look for correctness bugs. That is a separate
code review.

## Phase 0: Gather the diff

If the user request names a PR number, branch, commit range, or file path,
review that target. Otherwise run `git diff @{upstream}...HEAD` (or
`git diff main...HEAD` / `git diff HEAD~1` if there's no upstream). If there
are uncommitted changes, or the range diff is empty, also run `git diff HEAD`
and include the working-tree changes. The review often runs before the
commit. Treat this diff as the review scope.

## Phase 1: Review (4 cleanup reviewers in parallel)

Launch **4 independent read-only subagents** with the Task tool, all in one
message so they run concurrently. Give each the diff (or the exact command
that reproduces it) and one angle below. Each returns findings with `file`,
`line`, a one-line `summary`, and the concrete cost (what is duplicated,
wasted, or harder to maintain).

If no Task tool is available, work through all four angles yourself in one
pass. Do not skip an angle for lack of fan-out, and say in the final summary
that this was a single-pass review, not the 4-reviewer fan-out.

### Reuse

Flag new code that re-implements something the codebase already has. Search
shared and utility modules and files adjacent to the change, and name the
existing helper to call instead.

### Simplification

Flag unnecessary complexity the diff adds: redundant or derivable state,
copy-paste with slight variation, deep nesting, dead code left behind. Name
the simpler form that does the same job.

### Efficiency

Flag wasted work the diff introduces: redundant computation or repeated I/O,
independent operations run sequentially, blocking work added to startup or
hot paths. Also flag long-lived objects built from closures or captured
environments. They keep the entire enclosing scope alive for the object's
lifetime (a memory leak when that scope holds large values). Prefer a
class or struct that copies only the fields it needs. Name the cheaper
alternative.

### Altitude

Check that each change fixes the root cause at the right depth rather than
patching a symptom with a fragile bandaid. Special cases layered on shared
infrastructure are a sign the fix isn't deep enough. Prefer the simpler,
more general change to the underlying mechanism over adding special cases,
and name that change.

## Phase 2: Apply the fixes

Wait for all four reviewers, dedupe findings that point at the same line or
mechanism, and fix each remaining one directly. Skip any finding whose fix
would change intended behavior, require changes well outside the reviewed
diff, or that you judge to be a false positive. Note the skip rather than
arguing with it. Run the project's relevant tests or checks after editing.

Finish with a brief summary of what was fixed and what was skipped, or
confirm the code was already clean.
