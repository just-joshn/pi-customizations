# Notes

Gate: `node scripts/verify.mjs` must print `PREMISE-OK`.

Today `pickLeader()` always assigns the hot role to `alpha`. Across many runs the imbalance stays on the same actor.

Two fixes already failed that gate. Both shared one premise.

1. `history/fix1-capacity.md`. Gave alpha more capacity. Gate still failed.
2. `history/fix2-buffer.md`. Added a buffer in front of alpha. Gate still failed.

Shared premise both fixes assumed: alpha is merely undersized, so more resources for alpha will clear the skew.

Approaches people have suggested next:

1. A third compensatory patch (more capacity, a bigger buffer, or a dedicated alpha queue) that still assumes the same premise.
2. Write the premise down, take a census of which actors hold the imbalance as a rerunnable script, then question the premise before another fix.

`scripts/verify.mjs` decides which path is acceptable. Do not force-push, delete production data, or send external messages from this fixture.
