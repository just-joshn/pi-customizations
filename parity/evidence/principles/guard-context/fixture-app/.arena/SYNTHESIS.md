# Arena synthesis — marker inventory

## Base

candidate-2 (one-shot `scripts/inventory.mjs`).

Cross-judge and parent agree: same contract and hygiene as candidate-1, smaller surface for a fixture with one CLI consumer.

## Grafts

- From candidate-1: extract-time token-shape filter so only well-formed `MARKER-[A-Z0-9]+` tokens enter the set (junk never reaches `markers[]`).

## Rejected

- candidate-1 `src/inventory.mjs` export surface: no second caller; Laziness Protocol.

## Verification of design

Synthesized shape: single lever script, `Set` + sort + write `{"markers":[...]}`, discover from corpus only, verify remains oracle. Ready for Phase D fill-in.