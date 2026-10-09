# Offline progress while console locked

## Done (no unlock needed)

- Host setup-benny adapter → `/automate` + `AutomationPrepare`/`AutomationOpenEditor` (design gap 6).
- Probe check `piSetupBennyAdapterUsesAutomatePath=true`.
- poteto-help host list includes `/automate`; catalog census includes `automate`.
- `AutomationEnable` after receipt + confirm → local `status.json` enabled (no Slack ingress). Gap 5 Enable gate closed.
- Full `pi-pstack` suite green.
- Reports: `u-pi-setup-benny-adapter-automate-001`, `u-pi-automation-enable-receipt-001`.

## Still blocked on operator

| Gate | Need |
| --- | --- |
| G10 | Unlock Mac → Discard Untitled → Generate + 0600 key + probe (make-bot) |
| G4–G8 | Benny valid-config + Slack (triage + thread-safety live) |
| G1 | CU cloud claim attempt IDs |
| G2 | Enterprise live observation auth |
| G3 | Acceptance freeze (independent owner + custody) |

## Score

95/98 verified-pass-paired. 3 open mismatches. `completeDependencyClosure=false`. `completion.json` BLOCKED. Wait-unlock polling (`IOConsoleLocked=Yes`).

## Restart protocol

Do **not** tell the human **Restart now** while console locked / wait-unlock running.
