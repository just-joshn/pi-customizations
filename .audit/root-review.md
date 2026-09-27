# Independent maintained-code review

Reviewed `commands.ts`, `context.ts`, `host.ts`, `index.ts`, `questions.ts`, `state.ts`, `models.ts`, `resources.mjs`, and `verify-cli.mjs` after the root's extraction. Read the current official Pi source for session ancestry, tool declarations, and package paths.

## Actionable finding

`questions.ts` constructs selection keys with `${label} [${id}]`. Unique IDs did not imply unique resulting display strings. Options `{label: 'a', id: 'b] [c'}` and `{label: 'a [b]', id: 'c'}` collided and the Map dropped the first choice. Root added validation of rendered choice uniqueness before dialogs open. The reviewed final implementation rejects that ambiguity.

## Size and comment review

The reviewed files have 24 to 185 lines. Their maximum function spans are 11 to 33 lines. All satisfy the requested <50-function and <800-file limits.

Applied the no-comments and bundled Comment Sicko instructions as the independent reviewer delegated by root. The reviewed code has no comments, lint suppressions, or TypeScript suppressions to remove. Deletion count is zero. There are no comment-derived MUST KILL flags, restorations, reruns, encoding offers, or unfulfilled comment constraints. Model configuration text is generated user-facing configuration, not an application-code comment suppression.

Resource inventory JSON is versioned, hash-pinned build input. No new exploitable resource-path issue was established. Treating it as remote user input would add speculative validation unrelated to its present trust boundary.

## Remaining source behavior

The bundled renderer accepts non-string array elements and later calls string methods on them. Its row rendering repeatedly searches add/delete arrays, creating avoidable quadratic work. Root directed preservation of the source behavior following the user's resolution of the preservation conflict. No renderer transformation was applied or represented as a fix. Oversized functions and mutable structures in preserved helper copies likewise remain visible audit findings rather than claims of full compliance.

Pi extension prompt sections must be updated using the documented mutable event options. This host API effect is distinct from mutating project-owned business data. The report does not claim literal zero object mutations across every tracked artifact. Whole-project historical TDD and edge-case coverage for every preserved function have not been established.

## Python verification

The retained `.coveragerc` enables branch coverage, subprocess capture, and path mapping for copied replay scripts. The latest measured full run passed 40 Python tests with 91% combined coverage across all four canonical scripts. Individual coverage was doctor 91%, differential 91%, investigate 99%, and probe 86%. Two subsequent evidence-validity regressions also pass in the eleven-test differential suite. Root owns the final combined rerun. The configuration has no production-line exclusion rules.
