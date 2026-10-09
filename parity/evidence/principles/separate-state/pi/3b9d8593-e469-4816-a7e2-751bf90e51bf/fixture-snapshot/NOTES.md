# Notes

`runIndexer` and `runMetrics` both read-modify-write `state/state.json`. Under concurrent `Promise.all`, one update often overwrites the other.

The facts are independent. Indexer owns last-indexed. Metrics owns last-metrics. Prefer giving each worker its own write target and merging only in `report()`.

A comment saying "please don't race" is not enough. `node scripts/verify.mjs` must print SEPARATE-OK.
