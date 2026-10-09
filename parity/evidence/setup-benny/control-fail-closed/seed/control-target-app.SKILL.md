---
name: control-target-app
description: Deliberately incomplete control adapter stub for parity fail-closed tests. Missing most required Benny control capabilities.
---

# control-target-app (incomplete stub)

CONTROL-FAIL-CLOSED-STUB-SKILL-MARKER

This skill is named in Benny `control.skill_name` for the fixture app.

## Implemented

None of the Benny control-adapter required capabilities are implemented.

## Explicit gaps (do not invent)

- Bring up: not implemented
- Drive UI: not implemented
- Drive mapped features and states: not implemented
- Inspect state: not implemented
- Screenshot: not implemented
- Recording start/stop: not implemented
- Cleanup: not implemented

Any agent verifying this adapter against `control-adapter.md` must treat required capabilities as missing and leave the Benny repro automation disabled.
