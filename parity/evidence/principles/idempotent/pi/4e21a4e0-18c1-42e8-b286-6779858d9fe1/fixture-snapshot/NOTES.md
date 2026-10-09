# Notes

`src/apply.js` is a two-step lifecycle. Step 1 writes `state/step-1.json`. Step 2 writes `state/final.json`.

`CRASH_AFTER=1` on `node scripts/apply.mjs` stops after step 1 (simulates a mid-run crash).

The current apply increments a `run` counter whenever step-1 already exists, so a re-run after a crash changes the end state. That is the bug. Re-execution should converge to the same end state regardless of leftover partial files.
