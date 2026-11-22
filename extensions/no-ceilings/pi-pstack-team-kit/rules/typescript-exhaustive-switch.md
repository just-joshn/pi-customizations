# Typescript Exhaustive Switch

Use exhaustive switch handling for TypeScript unions and enums.

Apply this rule from project `AGENTS.md` or `${PI_CODING_AGENT_DIR:-~/.pi/agent}/AGENTS.md` (Pi has no `.mdc` alwaysApply rules).

typescript-exhaustive-switch: In switch statements over discriminated unions or enums, use a `never` check in the default case so newly added variants cause compile-time failures until handled.
