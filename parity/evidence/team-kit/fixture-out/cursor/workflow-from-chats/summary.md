# Workflow-from-chats synthesis

## Target workflow

Shipping and PR hygiene preferences: keep commits small, always run tests before opening a PR (test-before-PR), and never force-push. Prefer encoding durable rules over chat summaries.

## Evidence corpus

- Parent conversation `parent-alpha` (synthetic fixture corpus). Explicit user statements: short commits, always test before PR, never force-push; correction to stop summarizing chats and encode via FIXTURE_PREF.

## Preference profile

| Atom | Trigger | Decision rule | Confidence |
|------|---------|---------------|------------|
| Short commits | Preparing a git commit | Prefer small, focused commits | strong |
| test-before-PR | Before opening a PR | Always run tests first | strong |
| No force-push | Git push operations | Never force-push | strong |
| Prefer rules over summaries | Preference extraction | Encode durable guidance; do not summarize chats | strong |

## Adopt / consider / dismissed

- **Adopt:** short commits; test-before-PR; never force-push; encode as reusable rules (FIXTURE_PREF).
- **Consider:** none beyond the explicit atoms.
- **Dismissed:** chat summarization as an output shape.

## Proposed artifacts

- Reusable rule draft: `extracted-preferences.md` (FIXTURE_PREF + test-before-PR).
