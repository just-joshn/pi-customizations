# Setup parity: Clarifying Questions panel and the skill-driven flow

Status: design selected from captured reference evidence, 2026-10-08. Owner: implementation owner
(coordinator). Not an acceptance result; the closing evidence is the paired journey after repair.

## Reference oracle (Cursor 2026.10.01-e373342, pstack 0.15.15 @ ccb5507)

Captured journeys, equal fixture (user rule `# budget: small (medium)`, all 17 roles
`inherit-parent`, digest `sha256:2b6b4668…f6004`):

- `evidence/setup-prepair/cursor/` — complete happy path: agent turn (current state + detected
  models in chat) → one AskQuestion panel with 2 questions → Space + Enter → Enter submits →
  agent validates, writes the rule (chat diff `# budget: small (medium)` → `unlimited (max)`),
  confirms in chat, resolves the step-7 verification-skill check in chat.
- `evidence/cursor-panel-probe/` — Esc and checked-state observations.
- `evidence/pi-setup-explore/`, `evidence/pi-setup-explore` baseline: `evidence/setup-prepair/pi/`
  — the candidate's current flow: three native dialogs, no agent turn, exposed internal briefing.

## Panel chrome (exact, stable across three observed runs)

Full-width box `┌─…─┐`; lines inside:

1. ` Clarifying Questions`
2. blank
3. ` Question N of M`
4. blank
5. ` N. <prompt>` (prompt text is model-authored)
6. blank
7. options — cursor row `  › [ ] <label>`, others `    [ ] <label>`; selected shows `[x]`;
   last row always `    [ ] Other: (type to answer)`
8. blank
9. ` ↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip`

Byte-level geometry (probe-1 `cat -A`, 120 columns): the top border is ` ┌` + 116 `─` + `┐`
(119 bytes); every content row is ` │ ` + text padded to 114 + ` │` (119 bytes), aligned one
column under the top border. The candidate renderer initially emitted rows at column 0 with no
trailing space (found by the paired chrome comparison, 2026-10-08); fixed to the captured
structure and covered by `test/questions-panel.test.ts` byte-exact assertions.

Model-authored (rubric comparison, not exact): prompt texts, option labels beyond the Other row,
post-submit chat text, and the question batching — one run showed `Question 1 of 2`, another
`Question 1 of 1` then a second panel.

## Panel semantics (observed)

- The header line is the AskQuestion request's optional `title` (CursorAskQuestionRequest.title,
  parity/research/cursor-host/cli/retrieved/acp.md). Observed as the default `Clarifying Questions`
  in probe-1 and the 2026-10-08 01:13 run, and as the model-chosen `pstack model configuration` in
  the 2026-10-08 01:56 run. Model-authored: rubric comparison. The candidate accepts an optional
  `title` argument and defaults to `Clarifying Questions`.
- Space toggles the cursor option's checkbox (`[ ]` ↔ `[x]`).
- Enter advances to the next question; on the last question it submits.
- Esc submits the answered questions and skips the rest (the model continued with the answered
  budget and asked new questions; it did not re-ask the budget).
- Left/Right move between questions (footer text; navigation not separately exercised).
- Unobserved, open: how the Other row opens text entry, and up/down wrap behavior. The candidate
  implements Enter-on-Other to open an inline input and clamps (no wrap) until observed otherwise.

## Flow decision: skill-driven (Design B)

`/setup-pstack` becomes a normal skill delivery. The agent executes the skill: state inspection,
model detection, AskQuestion panels, validation, write, chat confirmation, step-7 check. The
candidate's native dialog flow (native budget select, roles picker, write confirm, exposed
briefing text) is deleted in the same wave.

Why: the reference observable sequence starts with an agent turn executing the skill; the contract
requires complete interaction sequences and preserves agent/skill distinctions. The native flow
also leaks internal orchestration text to the user, which the contract forbids. Determinism is not
lost: budget mapping, table building, validation and the atomic write stay in tested TypeScript.

- `pstack_setup` is reshaped to `{action:'state'}` (rule path, current budget, roles, dropped
  lines, available models from the Pi registry) and `{action:'write', budget, roleOverrides}`
  (validate + atomic write, returns the written table). The AskQuestion panels are the
  interactive confirmation, exactly as the Cursor agent's own file write is gated only by its
  skill discipline.
- Deletions in the same wave: `setupModels`, the roles/confirm `pick` usage, the
  `verificationOffered` store field and its follow-up message. The bundled skill transform in
  `scripts/resources.mjs` changes to instruct the agent-driven flow.

## Implementation order (test-first)

1. Panel reducer/renderer unit tests (chrome lines byte-exact against the captured oracle) →
   `src/questions-panel.ts`.
2. `questions.ts`: TUI path renders the panel through `ctx.ui.custom`; non-TUI keeps the
   existing dialog loop.
3. `setup-tool.ts` reshape + tests; delete the native flow and its tests.
4. Skill transform update + resource regeneration; extension suite + typecheck.
5. Real-Pi terminal fixture journey, then the closing paired journey through
   `capture-setup-journeys.mjs` with the comparator.