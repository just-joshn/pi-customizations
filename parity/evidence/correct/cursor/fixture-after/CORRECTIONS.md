# Operator corrections

## 2026-09-12

Agent imported `./db.js` from a feature module to fetch a row. Corrected to use `store.getUser` instead. Happened in PR review for `history/past-mistake-1.js`.

## 2026-10-01

Same class again. Another agent opened `src/db.js` from feature code and bypassed the store. Corrected in chat. Specimen kept at `history/past-mistake-2.js` (deleted from main after revert; content restored under `history/` for mining).
