# Thermo-nuclear review: src/process.js (branch `messy` vs main)

**Verdict: blocking (do not approve as is).**

## 1. Spaghetti / deeply nested conditionals (structural regression)
`processItem` went from a 1-line identity to a 4-level nested conditional pyramid (`!= null` -> `typeof object` -> `kind` -> `value > 0`). It also has a mutable `result` that is reassigned along the way, plus a redundant `else { result = item; }` that does nothing.

## 2. Duplicated branches (missed code judo)
The `a` and `b` branches are copy-paste identical except for the increment (+1 vs +2). That signals a missing data model: a table of increments by kind.

## Code-judo proposal
Replace the pyramid with a lookup table and guard clauses. This deletes the nesting, the mutable variable, the duplicated branch and the no-op else:

```js
const INCREMENT_BY_KIND = { a: 1, b: 2 };

export function processItem(item) {
  if (item == null || typeof item !== "object") return item;
  const step = INCREMENT_BY_KIND[item.kind];
  if (step === undefined) return item;
  return { ...item, value: item.value > 0 ? item.value + step : 0 };
}
```
Behavior is preserved. Use `Object.hasOwn` (or a `Map`) for the lookup so kinds like `"toString"` don't hit the prototype. A new kind then becomes one table entry, not a new branch.

## 3. Boundary / contract
- The input is loosely shaped (`kind`, `value`, with no type or doc). If this is TypeScript or JSDoc-typed, use a discriminated union and make the invariant explicit.
- `value` is never validated. A non-numeric `value` silently becomes `0`, because `undefined > 0` is false. Decide whether that fallback is intended.
- The function name `processItem` says nothing about the "increment positive value" semantics. Rename it.

## 4. Other
- File size is fine (23 lines, far below 1k).
- No tests accompany the new behavior. Add tests for null, a non-object, an unknown kind, and value <= 0 for each kind.
