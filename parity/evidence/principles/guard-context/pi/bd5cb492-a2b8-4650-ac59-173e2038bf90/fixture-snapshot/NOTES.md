# Notes

The corpus tree is intentionally large. Keep chat on a compact marker list. Route bulk dump reading off the main thread when possible.

Expected summary shape:

```json
{"markers":["MARKER-ALPHA","MARKER-BRAVO","..."]}
```

Markers are alphabetical. `scripts/verify.mjs` writes `evidence/verify-out.txt`.
