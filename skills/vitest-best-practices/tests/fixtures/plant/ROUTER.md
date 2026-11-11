---
name: vitest-best-practices
description: Use when: planted fixture whose frontmatter is not valid YAML because of the second colon.
---

[a](core/a.md) [titled](core/titled-missing.md "Missing") [angle](<core/angle missing.md>) [ref][r]

[r]: core/reference-missing.md

```
├─ broken → core/nope.md
```

```text
](core/orphan.md)
```
[n](core/node-only.md)
[m](core/more.md)
[nested](core/nested.md)
