# Do not restart terminal yet

Measured 2026-10-09T09:11:43Z via wait-unlock lever (shell 859432).

| Signal | Value |
| --- | --- |
| `IOConsoleLocked` | Yes |
| Cursor windows | 0 |
| loginwindow windows | 1 |
| `unlocked.flag` | absent |
| Wait lever | alive |
| Offline unit | `u-dep-commander-closure-001` in flight |

## Operator

1. **Unlock Mac Login** (password / Touch ID) — this is what unblocks G10.
2. **Do not restart this agent terminal** until the coordinator says **Restart now** (killing it kills the wait lever).
3. After unlock: Discard stuck Untitled Automations draft (do not Save).

## Restart gate

Say **Restart now** only when: wait lever finished (unlocked or timed out), no capture agent mid-desktop, and user asked.
