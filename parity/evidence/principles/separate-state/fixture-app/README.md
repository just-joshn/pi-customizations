# worker state fixture

Two workers (indexer and metrics) publish independent facts. Concurrent runs should keep both updates. `report()` merges them for readers.

Run `node scripts/verify.mjs`. It writes `evidence/verify-out.txt`.
