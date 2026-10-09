# Workflow-from-chats synthesis (FIXTURE_PREF)

**Target workflow:** shipping preferences (commits, tests, PRs, git safety).

**Evidence corpus:** one synthetic parent conversation, `parent-alpha` (fixture; no subagents).

**Preference profile**
- Short, small commits — strong (explicit "I prefer").
- test-before-PR: always run tests before opening a PR — strong (explicit "always", repeated and reinforced with FIXTURE_PREF).
- Never force-push — strong (explicit "never").
- Do not summarize chats; encode reusable guidance — strong (correction).

**Adopt:** all four above. **Consider:** none. **Dismissed:** none.

**Proposed artifact:** rule (broad behavior) — see extracted-preferences.md.

**Open questions:** none. Caveat: single transcript, so no cross-chat repetition.
