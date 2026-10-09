# Next-action picker decision

Observed on sample jobs `{a age=10}, {b age=20}, {c age=5}`:

| approach | pick | shape |
| --- | --- | --- |
| stalest-first | `b` | auto by max `ageMs` |
| menu-index | `a` | operator slot (default 0) |
| title-scan | `a` | lexicographic `title` |

**stalest-first** matches incomplete relay resume. Oldest wait is the urgency signal. No extra args.

**menu-index** needs an operator index at pick time. `pickNext(jobs)` has no index, so the default collapses to "first in array", which ignores wait time.

**title-scan** is stable but ranks names, not operational urgency. Wrong axis for relay backlog.

CHOSEN: stalest-first
