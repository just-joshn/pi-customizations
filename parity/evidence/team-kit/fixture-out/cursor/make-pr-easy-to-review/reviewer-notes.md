# Reviewer notes — team-kit-gh-fixture#1

## TL;DR
Adds a tiny `notes.md` placeholder (3 lines) so team-kit GitHub skill journeys have a disposable open PR to comment on and review. No product logic, no tests, no behavior change.

FIXTURE_REVIEW_GUIDANCE

## Reviewer guidance
- **Core file:** `notes.md` only — new markdown placeholder; skim it first and you are done.
- **Mechanical / generated:** none.
- **Risk:** negligible; content is fixture seed text, not runtime code.
- **Commits:** one commit (`Add notes placeholder for review journey`); history left intact (no rewrite / no force-push).
- **Tests:** none added; `npm test` checkbox is journey scaffolding, not a real verification ask for this diff.

## Diff shape
- Base: `main` → Head: `fixture/pr-comments-seed`
- Files: `notes.md` (+3 / −0)
- Single commit: `6b9a324` Add notes placeholder for review journey
