# Report: CU cloud claim re-probe (002)

## Status

VERDICT `ready-yes-attempt-ids-no` (unchanged). Re-measured 2026-10-09T10:53Z while console locked. `CURSOR_API_KEY` still **unset** in the agent shell. Keychain `cursor-access-token` still present. No GET/POST against Cloud Agents API with a User API Key. No attempt IDs. Edge stays unresolved. Ledgers not set to resolved.

## Probe

| Check | Result |
| --- | --- |
| `CURSOR_API_KEY` env | unset |
| Keychain `cursor-access-token` | present |
| `GET /v0/agents` with User API Key | not attempted (no key) |
| `POST /v0/agents` | skipped (no owner spend grant) |
| Attempt IDs | none |

Artifact: `parity/research/dep-cu-cloud-claim-002/cloud-claim-probe.json` (copy under `parity/evidence/computer-use/claim-002/`).

## Operator grant still required (G1)

Mint a Cursor User API Key (Dashboard → API Keys), export `CURSOR_API_KEY` in the harness shell, then re-run list-only probe. Do not POST create without explicit spend authorization.

## Non-claims

Does not resolve `cursor-cli-host` → `cursor-self-hosted-computer-use`. Local live-001 remains the only paid computer-use evidence.
