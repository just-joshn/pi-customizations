# Frontend runs

Start: `s50 frontend "<objective>" --consumer browser:<path>`. Same path as [feature.md](feature.md); ARCHITECT routes to `DESIGN`.

Route skills: DESIGN `frontend-design`, plus `vercel-react-best-practices` on a React or Next stack; REVIEW `web-design-guidelines` for web UI; VERIFY `agent-browser` for browser or electron consumers.

## Design checklist

Settle each item in grilling rounds or the design record before CONFIRM_TDD_SEAMS:

- subject
- audience
- primary job
- visual direction
- information hierarchy
- layout
- typography
- interaction model
- responsive behavior
- loading, empty, and error states
- accessibility

Record each item as a decision with id `design.<item>` (`design.subject`, `design.audience`, `design.primary_job`, `design.visual_direction`, `design.information_hierarchy`, `design.layout`, `design.typography`, `design.interaction_model`, `design.responsive_behavior`, `design.loading_state`, `design.empty_state`, `design.error_state`, `design.accessibility`) through `answer_decisions`. `DESIGN -> CONFIRM_TDD_SEAMS` is refused until all 13 exist.

## web-design-guidelines hash capture

In REVIEW, fetch the guidelines content once and pass the raw text in the review. The coordinator stores its sha256 and the locked `web-design-guidelines` commit, and attaches both to every finding recorded after it at the same revision:

```json
{"kind":"record_review","reviewer":"...","dimensions":["..."],"guidelinesContent":"<fetched command.md text>"}
```
