# Wait lever: open Cursor after unlock

Wait-unlock script now calls `open -a Cursor` when `IOConsoleLocked=No`, `loginWins=0`, and `cursorWins=0` (throttled ≥20s).

Operator still must unlock Mac Login. Do **not** restart this agent terminal until coordinator says **Restart now**.

Next capture after `unlocked.flag`: `parity/briefs/u-make-bot-auth-header-post-unlock-002.md`, then staged `u-dep-live-integrations-003`.
