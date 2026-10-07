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

## web-design-guidelines hash capture

In REVIEW, fetch the guidelines content once. Bind findings to its sha256 digest and the registry lock entry, so the review cites the exact revision of the guidelines. Findings carry `guidelines: {"contentHash":"sha256:<hex>","skillLock":"<source>@<commit>"}`:

```json
{"kind":"record_finding","finding":{"severity":"medium","trigger":"...","consequence":"...","evidence":"...","owner":"...","reviewer":"...","guidelines":{"contentHash":"sha256:<hex>","skillLock":"<lock entry>"}}}
```
