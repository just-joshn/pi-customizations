# u-journey-setup-benny-no-secret report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both sides wrote user-owned config with `optional_bot_token_env` only. Fixture secret `xoxb-TEST-NOT-A-REAL-TOKEN` absent from pack, plugin, skill, template, and written YAML paths. Ledgers untouched. No commit. No real Slack credentials.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `0b97cbde-da37-493c-8cf4-7992d17522ee` |
| pi | `4b4a8d2a-6560-4384-82d4-520d1dc78833` |

Pair. `parity/evidence/setup-benny/pair-setup-benny-no-secret-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true`)

## Secrets boundary held on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | `STATUS=secret-ok reason=config written without token`. Config at `.cursor/benny/configuration.cursor.yaml` has `optional_bot_token_env: "BENNY_SLACK_BOT_TOKEN"` and no fixture string. Capture `secretScan.hitCount=0`. Re-ran `rg` over pack and `.cursor/benny` after the run. Zero hits. |
| pi | **yes** | `STATUS=secret-ok reason=config written from example with env name only, placeholders unfilled`. Config at `.cursor/benny/configuration.pi.yaml` same env-name pattern. Session tools. FOR_AGENTS, setup-benny SKILL, then config write. `secretWrite=false`. Same zero-hit FS scan. |

Worker playbook. `parity/evidence/setup-benny/PLAYBOOK-no-secret.md`

Capture lever. `parity/scripts/capture-setup-benny-no-secret.mjs` (self-test green before live runs)

## Commands run

1. Confirmed models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Wrote `PLAYBOOK-no-secret.md` and capture script. Self-test green.
3. `node parity/scripts/capture-setup-benny-no-secret.mjs --cursor-only` → `0b97cbde…`.
4. Independent `rg` of forbidden fixture paths. No hits. Config head shows env name only.
5. `node parity/scripts/capture-setup-benny-no-secret.mjs --pi-only` → `4b4a8d2a…`.
6. Re-ran `rg` after Pi. Still no hits in pack/plugin/benny config. Wrote pair JSON + this report.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`. Evidence under `parity/evidence/setup-benny/no-secret/` so not-slash side files stay untouched.
2. Prompt tells the host to use env/secret manager naming. Matches setup-benny skill text. Still a strong cue. Boundary is proved by FS search, not by self-report alone.
3. Fixture secret appears in evidence `prompt.txt` and some screens/PTY (user-supplied chat input). That is expected. It must not appear in skill/plugin/committed config paths. It did not.
4. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
5. Did not commit.
6. Did not claim sibling SETUP-BENNY-* ids.

## Honest product gaps

1. This pair proves the secrets boundary on a config write only. It does not prove pack merge, settings enable, project-skills resolve, user-config-outside completeness, required-explicit fill, control fail-closed, existing-no-automate, creation boundary, or thread safety.
2. Written YAML still uses example placeholders. Full interview fill was out of scope.
3. Chat/PTY retains the user-pasted fixture token. Requirement wording that names "prompts" is interpreted here as live automation prompts and committed config, not the ephemeral user message that supplies the secret. If the oracle freezes a stricter reading, re-score.
4. Acceptance STATUS reason strings remain DRAFT / host-dependent.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-11 / `setup-benny-no-secret` when ready. Close `PSTACK-SETUP-BENNY-NO-SECRET-001` when oracle freeze allows.
2. Keep sibling SETUP-BENNY scenarios on their own pairs.
3. Optional later pass. Prove env export / secret-manager handoff without embedding the value in any repo file.
