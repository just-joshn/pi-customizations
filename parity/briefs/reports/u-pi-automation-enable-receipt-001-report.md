# Report. u-pi-automation-enable-receipt-001

## Status

MERGED (package). Design gap 5 Enable gate closed for local status. Does **not** close live Slack thread-safety mismatch.

## What landed

| Piece | Behavior |
| --- | --- |
| `enableAutomation` | Writes `status.json` `{ kind: 'enabled', revision }` only when `thread-safety.json` matches revision and all seven checks are true. No process spawn. No Slack ingress. |
| `AutomationEnable` | Refuse without receipt; require `ctx.hasUI` + `ui.confirm`; decline → `{ enabled:false, refused:false }`; approve → local enabled. |
| Schemas | `AutomationEnableOutput` union; `AutomationInspectOutput` includes `kind:enabled`. |
| Tests | Enable-with-receipt; decline-despite-receipt; prior refuse-without-receipt kept. |
| Adapter/skill | Post-checks: RecordThreadSafety then Enable; creation skill still must not Enable during create. |

## Non-claims

- `SETUP-BENNY-THREAD-SAFETY-ENV` still open (live Slack seven-checks unpaid).
- Gap 4 Slack ingress still open.
- No ledger verify of `PSTACK-SETUP-BENNY-THREAD-SAFETY-001`.

## Verify

`vitest` automations + structure + benny + catalog: pass.
