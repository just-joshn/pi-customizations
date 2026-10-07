# Frontend runs

Start with `s50 frontend "<objective>"`. Without `--consumer`, the consumer is a browser. Any run with a browser or Electron consumer is web UI too.

Route skills: DESIGN `frontend-design`, plus `vercel-react-best-practices` when a `--constraints` entry names React or Next.js or the repository depends on `react` or `next`; REVIEW `web-design-guidelines`; VERIFY `agent-browser` for browser and Electron consumers.

## Design brief

Settle each item before implementation and record it as a decision named `design.<item>`:

- `design.subject`
- `design.audience`
- `design.primary_job`
- `design.visual_direction`
- `design.information_hierarchy`
- `design.layout`
- `design.typography`
- `design.interaction_model`
- `design.responsive_behavior`
- `design.loading_state`
- `design.empty_state`
- `design.error_state`
- `design.accessibility`

```json
{"kind":"answer_decisions","decisions":[{"id":"design.subject","question":"What is the screen about?","answer":"the invoice list","decidedBy":"user"}]}
```

`DESIGN -> CONFIRM_TDD_SEAMS` is refused until all 13 decisions exist.

## Guideline digest

`web-design-guidelines` fetches its rules fresh on every run. In REVIEW, pass the fetched text once with the review. The coordinator stores its sha256 and the locked skill commit on the review, and attaches both to every finding at that revision, including findings recorded before the review:

```json
{"kind":"record_review","reviewer":"reviewer-1","independent":true,"dimensions":["correctness_and_acceptance_criteria","domain_invariants","authorization_and_data_integrity","error_handling","concurrency","migration_safety","architecture_and_module_depth","caller_knowledge","duplicate_domain_knowledge","test_quality_and_confirmed_seams","reader_load","dead_or_replaced_code","frontend_design_contract","web_design_guidelines","agent_browser_verification"],"guidelinesContent":"<the fetched command.md text>"}
```

Add `vercel_react_best_practices` to the dimensions when the run is a React or Next.js run.
