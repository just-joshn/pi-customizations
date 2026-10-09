# u-typescript-paths-gate report

## Status

**pass.** TYPESCRIPT-PATHS-FRONTMATTER closed on a linked Cursor+Pi pair. Both hosts `contractOk` / `pathsOk`. Package skill digest matches locked Cursor `28f9e617…`. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID | Notes |
| --- | --- | --- |
| cursor | `b7688706-b64f-4a12-a61c-fd09c78a2722` | Reused from pair-1. Fixture digest unchanged. |
| pi | `3ab0995e-f5c8-4ce3-a1e3-55e86e66a8f3` | Fresh `--pi-only` after generator fix. |

Pair. `parity/evidence/typescript/pair-typescript-paths-2.json`

Prior fail. `parity/evidence/typescript/pair-typescript-paths-1.json` (Pi package omitted `paths`, digest `a40da091…`).

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Metadata contract?

| Side | paths `**/*.ts` + `**/*.tsx` | disable-model-invocation | type-system-discipline first | Verdict |
| --- | --- | --- | --- | --- |
| cursor | **yes** (digest `28f9e617…`) | **yes** | **yes** | **contractOk** |
| pi | **yes** (same digest `28f9e617…`) | **yes** | **yes** | **contractOk** |

Oracle. Re-read on-disk skill files after PTY settle (`shasum -a 256` both hosts equal locked digest). Pi `screen-02-submitted` shows `[skill] typescript-best-practices`. Session `01a11d7f…` injects the skill body with the type-system-discipline-first line. Host still injects a read-before-`.ts`/`.tsx` rule because Pi has no path trigger. That host rule is complementary. It is not the frontmatter `paths` field.

## Product change (uncommitted)

`resources.mjs` no longer strips `paths:` from skill frontmatter. It still strips Cursor-only `mode` / `icon` / `color` / `reminder`. Regenerated `skills/typescript-best-practices/SKILL.md` and resource-map hashes. Tests updated so typescript retains the paths line while other Reference-only keys stay forbidden.

## Commands run

1. Reproduced missing paths on shipped skill vs upstream (digest `a40da091…` vs `28f9e617…`).
2. Patched generator + tests. `npm run generate` then `npm test -- --run test/resources.test.ts test/skills-parity.test.ts test/parity-generator-flags.test.ts` → 26 passed.
3. `node parity/scripts/capture-typescript-paths.mjs --self-test` → green with `pi-package-retains-paths-contract`.
4. `node parity/scripts/capture-typescript-paths.mjs --pi-only` (~22s). Exit 0. `pathsOk` / `contractOk` true.
5. Re-read screens, skill digests, Pi session skill block and `pstack_host` paths note.

## Deviations

1. Reused Cursor pair-1 attempt (brief allows reuse when fixture identical). Fresh Pi only.
2. Capture script writes side screens next to `parity/evidence/typescript/pi/`; copies also live under the attempt dir for the pair path.
3. Capture `screenFinal.typescriptSkill` false after settle (prompt scrolled off). Attachment proven from `screen-02-submitted` and the Pi session.
4. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
5. Did not commit.
6. Bug-fix playbook steps 5–6 skipped (no commit / no PR per brief FORBIDDEN).
7. Nested how/why/architect subagents skipped. System forbids nested subagents for this worker. Cause was a single-site strip in `resources.mjs`.

## Remaining gaps

1. Model identity chrome still differs (Cursor Auto vs Pi claude-sonnet-5-5). Unrelated to this requirement.
2. Pi still does not auto-trigger skills from `paths` globs. Host read-before-edit remains. Frontmatter parity is satisfied; native path-trigger behavior is not claimed.
3. Package docs such as `docs/current-source-parity.md` still describe the old strip policy. Out of this brief's edit scope.

## Suggested follow-ups for the coordinator

1. Point TYPESCRIPT-PATHS-FRONTMATTER / `PSTACK-CMD-TYPESCRIPT-PATHS-001` at pair-2 and mark the mismatch reconciled.
2. Land the generator + skill + test changes when ready to commit.
3. Optionally refresh prose that still says the generator removes `paths:`.
