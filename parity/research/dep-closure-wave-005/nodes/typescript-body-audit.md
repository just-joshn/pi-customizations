# typescript@7.0.2 per-file body audit

Inventoried files: 416.
Body-audited files: 416.
Hash mismatches: 0.
Structural body audit complete: True.
Deep internal files still open for compiler semantics: 136.

Audit definition:
For each inventoried file: recompute sha256/byteLength against wave-002 inventory, classify role, and extract body-contract facts (encoding, license/copyright markers, JSON validity for maps/package.json, export/import/require counts and stub detection for modules).

Structural and module-surface body contracts were extracted for all 416 files. Behavioral semantics of TypeScript compiler internals (AST transforms, enum tables, internal helpers) were not proven against runtime typecheck journeys.

Evidence: parity/research/dep-closure-wave-005/npm/typescript-body-audit.json
