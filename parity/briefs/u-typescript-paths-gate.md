GOAL
Repair Pi `typescript-best-practices` so shipped skill metadata retains `paths: ["**/*.ts", "**/*.tsx"]` (matching locked Cursor digest frontmatter), close TYPESCRIPT-PATHS-FRONTMATTER, and recapture a linked pass-paired run.

SCOPE
May edit `extensions/pi-pstack/scripts/resources.mjs`, related tests (`skills-parity`, `resources`), regenerate `skills/typescript-best-practices/SKILL.md` (+ resource-map hashes if required), `parity/evidence/typescript/`, capture scripts, `parity/briefs/reports/u-typescript-paths-gate-report.md`.
Must not edit ledgers.

CONTEXT
Mismatch TYPESCRIPT-PATHS-FRONTMATTER from `parity/evidence/typescript/pair-typescript-paths-1.json`: Cursor `pathsOk` true (digest `28f9e617…`); Pi package skill omits `paths` because `resources.mjs` strips `paths:` as Reference-only. Host read-before-edit substitute is not frontmatter parity. Requirement `PSTACK-CMD-TYPESCRIPT-PATHS-001`. Standing orders at orch preferences path.

ACCEPTANCE
- Generated/shipped Pi skill frontmatter includes `paths: ["**/*.ts", "**/*.tsx"]` and `disable-model-invocation: true`; body still requires type-system-discipline first.
- Package tests green for the changed policy.
- Linked recapture: both hosts `contractOk` / `pathsOk` (reuse Cursor `b7688706` if fixture unchanged).
- Report for coordinator; no ledger edits.

VERIFY
Re-read on-disk skill YAML digests/screens. Real PTY for Pi (and Cursor if needed).

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No commit. No fabricating paths metadata. Do not claim host-substitute rule equals `paths` frontmatter.

REPORT
parity/briefs/reports/u-typescript-paths-gate-report.md

STANDING
Obey orch preferences.md.
