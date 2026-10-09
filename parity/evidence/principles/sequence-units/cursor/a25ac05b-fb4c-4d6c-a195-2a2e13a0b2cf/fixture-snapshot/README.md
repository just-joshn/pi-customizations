# tag migrate fixture

Three modules export a `TAG` string. Each still uses the old `OLD_` prefix.
Target shape is `NEW_` plus the module stem (`NEW_alpha`, `NEW_beta`, `NEW_gamma`).

Change one module at a time. After each module, run `node scripts/verify.mjs`.
That check writes per-unit markers under `evidence/units/` and appends
`evidence/verify-log.jsonl`, plus a final line in `evidence/verify-out.txt`.
