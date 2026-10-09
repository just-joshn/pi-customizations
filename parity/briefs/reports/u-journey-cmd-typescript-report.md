# u-journey-cmd-typescript report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, honest host deltas). Cursor loaded skill meets the full metadata contract. Pi package skill fails `paths` (honest product gap). Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `b7688706-b64f-4a12-a61c-fd09c78a2722` |
| pi | `245162a9-8cf4-43c1-8fff-cf994cae25ad` |

Pair. `parity/evidence/typescript/pair-typescript-paths-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Metadata contract?

| Side | paths `**/*.ts` + `**/*.tsx` | disable-model-invocation | type-system-discipline first | Verdict |
| --- | --- | --- | --- | --- |
| cursor | **yes** (`paths: ["**/*.ts", "**/*.tsx"]`, digest `28f9e617…` matches locked) | **yes** | **yes** (first body line after H1) | **contractOk** |
| pi | **no** (package skill omits `paths`, digest `a40da091…`) | **yes** | **yes** (package body + session skill block) | **mismatch** |

Oracle. Re-read on-disk skill files after PTY settle. Cursor slash retained on `screen-01-typed` / `screen-02-submitted`. Pi screen shows `[skill] typescript-best-practices`; session `01a11d7a…` injects the package skill body with the type-system-discipline-first line. Pi `pstack_host` also states Pi has no file-path skill trigger and substitutes a read-before-`.ts`/`.tsx` rule.

Worker capture playbook. `parity/evidence/typescript/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Wrote worker `PLAYBOOK.md`, fixture-app (`src/id.ts`, `src/Badge.tsx`), then `parity/scripts/capture-typescript-paths.mjs`.
3. `node parity/scripts/capture-typescript-paths.mjs --self-test` (locked skill pass; Pi package missing-paths case pass).
4. `node parity/scripts/capture-typescript-paths.mjs --cursor-only` (~42s).
5. `node parity/scripts/capture-typescript-paths.mjs --pi-only` (~18s).
6. Re-read screens, skill digests, Pi session skill block and `pstack_host` paths substitute.

## Honest product gaps

1. **Pi package skill dropped `paths`.** Locked Cursor / upstream skill digest `28f9e617…` declares `paths: ["**/*.ts", "**/*.tsx"]`. Shipped `extensions/pi-pstack/skills/typescript-best-practices/SKILL.md` digests `a40da091…` and has no `paths` key. Upstream snapshot under `extensions/pi-pstack/upstream/skills/…` still has paths.
2. **Pi host substitute, not frontmatter parity.** Session `pstack_host` tells the model to read the skill before editing `.ts`/`.tsx` because "Pi has no file-path skill trigger." That is a behavioral workaround, not the required frontmatter declaration.
3. Session skill injection for Pi drops YAML frontmatter, so `disable-model-invocation` is only observable on the on-disk package file, not in the injected `<skill>` block.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Capture script `screenFinal.typescriptSkill` was false after settle (prompt scrolled off). Attachment proven from earlier screens and the Pi session, not the settled frame.
3. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or scenario stubs.
4. Did not commit.
5. Did not patch the Pi package skill to restore `paths` (out of worker scope; recorded as product gap).

## Suggested follow-ups for the coordinator

1. Merge `typescript-paths-1` into `cmd-typescript-paths` evidence when ready.
2. Restore `paths: ["**/*.ts", "**/*.tsx"]` on the Pi package skill (or document an accepted exclusion if the host substitute is the intended Pi binding).
3. Optionally recapture after the package skill digest matches the locked Cursor skill.
