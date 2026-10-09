`clamp(n, lo, hi)` forces a number into the range from `lo` to `hi`, both ends included. If `n` is below `lo` you get `lo`. If it is above `hi` you get `hi`. Otherwise you get `n` back.

It is three comparisons in `src/clamp.js`. The lower check runs first, then the upper, then it falls through to `n`. Values exactly on a bound come back unchanged, and `lo === hi` always returns that one value.

It does no validation, so a few inputs behave in ways you might not expect. `NaN` fails both comparisons and comes back as `NaN`. If you pass `lo > hi`, a value between them returns `lo`, because the lower check wins. Types are not checked either, so JavaScript's normal comparison rules decide the result.

On why the checks live here: the source says so directly. The doc comment says callers use the helper "once instead of repeating min/max at every site", and the README says it keeps call sites thin. So the stated reason is to avoid duplicating the bound logic. The likely upside is that every caller gets the same behavior, and that is my inference. Nothing in the repo shows testability or future consistency as a goal.

I could not find out when or why the decision was made. There is no git history for the file, and the fixture has no call sites, so I can't tell how widely it is used. The reason above is the author's stated intent only.

I can go further on the edge cases, or on how a caller would guard against `NaN` or reversed bounds.
