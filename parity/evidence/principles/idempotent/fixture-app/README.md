# lifecycle apply fixture

Tiny Node lifecycle. `apply()` should converge `state/final.json` to the same end state whether it runs clean, crashes after step-1, or re-runs after a partial prior execution.

Run `node scripts/verify.mjs` to check. It writes `evidence/verify-out.txt`.
