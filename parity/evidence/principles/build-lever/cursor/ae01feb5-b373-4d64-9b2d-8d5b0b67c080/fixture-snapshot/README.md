# prefix rewrite fixture

Three modules export a `TAG` string. Each still uses the old `LEGACY_` prefix.
Target shape is `APP_` plus the module stem (`APP_alpha`, `APP_beta`, `APP_gamma`).

Re-runnable check: `node scripts/verify.mjs` writes `evidence/verify-out.txt`.
