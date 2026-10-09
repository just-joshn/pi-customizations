# fix-merge-conflicts resolution

## Files resolved
- `value.txt` (both modified: `main` vs `feature`)

## Notable resolution choices
- Replaced conflict markers with the required single-line content `resolved-value` (neither `main-value` nor `feature-value`).
- Staged `value.txt`; left merge uncommitted per instructions (no push).

## Build/test outcome
- No package/build/test harness in this fixture.
- Verified: one line, exact content `resolved-value`, zero conflict markers.
