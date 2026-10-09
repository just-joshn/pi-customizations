# Report. u-pi-automation-disable-001

## Status

MERGED (package). Local disable lifecycle for Pi automations. Does not close Slack/env mismatches.

## What landed

| Piece | Behavior |
| --- | --- |
| `disableAutomation` | Unlinks `status.json` (absent ⇒ disabled). Keeps `definition.json` and `thread-safety.json`. |
| `AutomationDisable` | Direct tool; idempotent; returns disabled draft. |
| Adapter / FOR_AGENTS | Mentions Disable; FOR_AGENTS says automation definitions (not routine). |
| Source-lock note | Enable no longer described as refuse-closed stub. |

## Non-claims

- No Slack ingress.
- No verify of thread-safety / triage / make-bot requirements.
- `completeDependencyClosure` stays false.

## Verify

`vitest` automations + structure + benny: pass.
