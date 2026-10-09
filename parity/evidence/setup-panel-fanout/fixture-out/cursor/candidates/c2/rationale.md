# clamp rationale (c2)

## Chosen approach

Early-return branching: compare `n` against `lo` and `hi` with two `if` guards, then return `n` unchanged when in range. Exported as CommonJS `{ clamp }`.

## Alternatives considered and rejected

1. **Nested `Math.min` / `Math.max`** (`Math.min(hi, Math.max(lo, n))`) — compact and idiomatic, but rejected here so this candidate stays structurally distinct from the usual one-liner composition style.
2. **Ternary chain** (`n < lo ? lo : n > hi ? hi : n`) — same control-flow idea as branching, but denser and harder to scan; rejected in favor of explicit early returns.
3. **`module.exports = clamp` (default export)** — valid CommonJS, but rejected so the named `{ clamp }` shape matches typical multi-export helpers and keeps the API explicit at the call site.
