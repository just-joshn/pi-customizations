---
description: "Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant."
argument-hint: "[request]"
---
Use the pstack `principle-separate-before-serializing-shared-state` skill for this request. Read its `SKILL.md` in full before anything else: `generated/skills/principle-separate-before-serializing-shared-state/SKILL.md` under the pi-pstack package root (`pi list` names the package). Then follow it.

Request: $@
