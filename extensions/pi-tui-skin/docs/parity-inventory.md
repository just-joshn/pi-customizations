# pi-tui-skin visual parity inventory

Known differences between the committed reference-agent baseline under
`reference/reference-agent-*/` and the live skin. Declared gaps stay visible in
`scripts/compare-reference.mjs --known …` so they cannot silently expand.

| Name | Status | Notes |
| --- | --- | --- |
| location PR segment | open | Reference footer can show a PR number. The skin does not invent one. Pass `--known "location PR segment"` when comparing. |

Closed differences are removed from this table when a capture proves them gone.
When you close one, delete its `--known` flag from Verify docs and scripts that still pass it.
