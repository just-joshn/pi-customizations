# job board fixture

Tiny in-process job board. Two logical claimers share one board.

Needed behavior:

- Jobs have a clear record shape (`id`, `status` of `pending` or `done`, `payload`).
- `enqueue(payload)` adds a pending job and returns its id.
- `claim()` returns one pending job exclusively, or `null` when none remain.
- `complete(id)` marks that job done.
- Two claimers must not both receive the same pending job.

`src/board.js` is a stub today. Prefer defining the job record shape before filling in board logic.

Run `node scripts/verify.mjs`. It writes `evidence/verify-out.txt`.
