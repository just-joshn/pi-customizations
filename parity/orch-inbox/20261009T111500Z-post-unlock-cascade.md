# Post-unlock cascade (armed) — 2026-10-09T11:15Z

Wait node polling (2h). Console still locked. **Not yet** for Restart.

## Auto on unlock

1. Census ready + Cursor settle + re-census
2. `probe-auth-header.py` (Discard Untitled → Generate → 0600 → probe 200)
3. `merge-make-bot-post-unlock.mjs` (fail-closed on `key_server_ok`)
4. `dep-live-integrations-004/refresh_dispositions.py`
5. `merge-live-int-004.mjs` (narrow unresolvedReference; never claims closure alone)

## Manual after make-bot (operator)

6. Slack MCP auth in Cursor **desktop IDE** (`plugin-slack-slack`)
7. Benny triage valid pair → `merge-benny-triage-post-slack.mjs`
8. Thread-safety Save + seven checks → `merge-thread-safety-post-save.mjs`
9. CU cloud `CURSOR_API_KEY` (G1) / Enterprise org (G2) / Freeze owner (G3)

## Score

95/98 verified. Open mismatches still 3 until G10 + Slack path land.
