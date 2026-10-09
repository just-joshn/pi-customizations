# Why: bound checks live in clamp.js

- Confirmed: src/clamp.js doc comment says callers use the helper "once instead of repeating min/max at every site."
- Confirmed: README.md says clamp owns the bound checks so "call sites stay thin."
- Inferred: centralizing gives callers one uniform operation and removes repeated min/max logic. Benefits like testability or future consistency are not evidenced.
- Unknown: no history. git log --follow returned nothing and git blame failed (files not in HEAD). When and why the decision was made is not recoverable.
- Unknown: the fixture has no call sites, so actual usage cannot be checked.
- Not searched (narrowed scope): issue trackers, docs beyond README, chat, observability, error tracking, analytics.
