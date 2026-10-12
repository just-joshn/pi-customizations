# Review context: pi-pstack-two

You are reviewing a port of the Cursor plugin pstack 0.15.17 (cursor/plugins@11713c6, MIT) and its named dependencies to Pi 1.1.0, as the Pi package `extensions/pi-pstack-two` in the repository at the current working directory. You share no context with the author. This is a read-only review: do not edit, create, or delete files in the repository, and do not commit. You may read files, search, and run read-only commands, including the test suite.

Read first:
- `parity/pi-pstack-two/spec.md` (requirements with IDs and evidence)
- `parity/pi-pstack-two/decisions.md` (designs considered and chosen, Pi API citations)
- `parity/pi-pstack-two/ledger.json` (status per requirement; the validator derives the verdict)
- `parity/pi-pstack-two/evidence/live-summary.md` and `evidence/tui-smoke.md`
- `extensions/pi-pstack-two/README.md`

Code under review (all new): `extensions/pi-pstack-two/src/**`, `extensions/pi-pstack-two/test/**`, `extensions/pi-pstack-two/scripts/sync-upstream.mjs`, `scripts/patches.json`, `scripts/live-e2e.mjs`, `skills/create-skill/SKILL.md` (authored). Everything else under `extensions/pi-pstack-two/skills`, `agents`, `docs/guide`, `automations`, and `licenses` is generated from upstream and pinned by `upstream.lock.json`.

Repository changes outside the package (`git diff`): `biome.json`, `tsconfig.json`, `scripts/check-agents-compliance.mjs`, `scripts/check-typescript-policy.mjs`, and `extensions/scripts/check-vitest-conventions.mjs` exempt the generated `extensions/pi-pstack-two/skills` tree, as they already exempt `extensions/pi-pstack/skills`; `bun.lock` adds the new workspace member.

Results the author reports on the final revision:
- `bunx vitest run` in the package: 19 files, 175 tests passed (deterministic; the end-to-end tests drive the real Pi CLI with Pi's faux provider, `test/fixtures/scripted-model.ts`).
- `bun run typecheck`, `biome ci`, the repo's agents-compliance and vitest-convention checks: clean.
- `node scripts/sync-upstream.mjs --check --source <cursor/plugins clone>`: 165 files match the pin.
- Real-model runs (`scripts/live-e2e.mjs`, deepseek-flash and claude-sonnet-5-5) and Cursor baselines: see `evidence/live-summary.md`.
- Pi 1.1.0 docs and declarations are installed under `extensions/pi-pstack-two/node_modules/@earendil-works/pi-coding-agent/` (`docs/`, `dist/**/*.d.ts`).

Output format. Write Markdown with two sections: "Confirmed defects" (each with file path and line, the evidence you checked, and severity high/medium/low) and "Suspicions and questions" (things you could not confirm). End with a one-paragraph overall assessment. Cite paths and line numbers. Do not pad the report; an empty section is fine.
