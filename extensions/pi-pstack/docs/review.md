# Review of the Pi extension

Reviewed implementation snapshot during development, 2026-09-26. Scope: `src/`, `test/`, and `scripts/resources.mjs`; source-vendored files were excluded from comment review. The upstream Comment Sicko instructions were read in full. This report records findings for the implementing agent; it does not claim the findings remain unresolved after subsequent edits.

The reviewer is a separate agent using the same model family as the implementing agent. This is an independent pass, not a cross-family or multi-model review. The reviewer authored the models module earlier, so review of that module is not independent; the independent correctness focus was index wiring and resource generation.

## Comment review

No source comments or suppression directives were found in the scoped implementation and tests by the comment/suppression search. No comment deletions are proposed. No `MUST KILL` flags have supporting comment evidence. Source files touched: none. Report file written: `docs/review.md`. Deletion count: zero. Skips: upstream/generated skill prose and all vendored source.

## Correctness findings

1. **P1 — Native `/skill:` commands bypass the intended mode and setup handlers.** At the reviewed `src/index.ts:90`, input handling recognizes only expanded `<skill name=...>` blocks. Official Pi `agent-session.ts:1634` emits `input` before `_expandSkillCommand` at line 1649; its queued-input path does the same at lines 1824–1833. Therefore an actual `/skill:poteto-mode` input does not toggle persistent mode, and `/skill:setup-pstack` does not invoke `setupModels` and its validated confirmation UI. Short `/poteto-mode` and `/setup-pstack` aliases work, which is why existing alias integration tests do not catch this. Handle the raw native command through the appropriate extension boundary and test native enter, off, setup, and headless rejection. Respect discovery ownership when skill names collide.

2. **P1 — Generated authoring instructions still write skills to Cursor paths.** At the reviewed `scripts/resources.mjs:41`, the only path rewrite is the model rule. Generated `skills/create-verification-skill/SKILL.md:25` explicitly directs writing `.cursor/skills/verify-<app>/SKILL.md`, and its line 36 writes the feature map there. The extension offers this workflow immediately after model setup. Official Pi skill discovery reads `.pi/skills` and `.agents/skills`, not `.cursor/skills`; an accepted setup offer therefore produces an undiscovered verification skill. `maintain-verification-skill` and `automate-me` also retain Cursor skill paths. Translate operational skill destinations and matching lookup paths to Pi locations, recording each transformation. Preserve original upstream files.

3. **P3 — Verification setup only checks registered command names.** At the reviewed `src/index.ts:61`, the offer is suppressed for any visible `verify-*` command, including a user-scoped skill, but no existing project harness is inspected. Upstream setup step 7 asks whether the project has a verification skill *or an existing harness*. This may offer redundant work for projects with a working harness or suppress a useful project-local offer because an unrelated global verification skill exists. Check project-scoped evidence before offering, or let the skill inspect that evidence before proposing creation.

## Reviewed behavior without a confirmed defect

State restoration reads the active `SessionManager.getBranch()` and uses the most recent valid custom state. It resets state before restoration. Both `session_start` and `session_tree` invoke restoration; current official Pi runtime emits `session_start` for new sessions, switches/resumes, forks, and reloads. The structure is consistent with branch-specific sticky mode and todos. Existing integration coverage demonstrates reopen and explicit off; branch navigation and forks still need direct behavioral coverage.

Model setup rejects headless UI, preserves all 17 role labels and repeated panel aliases, presents the complete table, requires explicit confirmation, validates before writing, and atomically replaces the MDC file. Cancellation is not approval. The associated tests use the supported provider factory catalogue API and exercise canceled and denied writes plus budget flooring. Setup's successful boolean return is correctly used to gate the later verification offer.

Model resolution requires an exact available provider/model or an unambiguous bare model ID. It does not silently replace unavailable Cursor slugs with a different family. `auto` and `inherit-parent` retain parent selection. No live cross-family provider execution was reviewed or established by these tests.

The generator checks the complete pinned source file list and each upstream SHA256 before generating, verifies output bytes, rejects extra generated skill files, and records transformations. It does not register dormant Benny files as skills. Source inventory completeness is distinct from runtime behavior parity.

## Parity claims and remaining evidence

The runtime status explicitly calls the package partial runtime parity. Its system instructions identify missing Cursor cloud execution, loops/goals, automation editor, Grok Bot routines, external team-kit skills, connectors, and Benny credential isolation. These disclosures are appropriate. The package cannot truthfully claim 100% behavior parity while those required paths remain unavailable. Keeping original files and stopping at a missing gate preserves source intent but does not implement the missing capability.

At review time `docs/parity.md`, referenced by `/pstack`, had not yet been written. Ensure that artifact exists before delivery and separates shipped/tested behavior from service-dependent and unsupported behavior. The review did not launch external services, use provider credentials, run Slack automations, or validate live model agreement.
