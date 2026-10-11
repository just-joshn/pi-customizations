# Parity ledger schema

`parity/<capability>/ledger.json` is the source of truth. Generate the markdown table from it. Never write the table by hand.

```json
{
  "capability": "claude-code/pre-tool-use-guard",
  "verdict": "INCONCLUSIVE",
  "requirements": [
    {
      "id": "GUARD-001",
      "sourceBehavior": "Blocks `rm -rf /` before the shell tool runs and shows the reason to the model",
      "evidence": "docs: hooks reference §PreToolUse; fixtures/block-rm.json",
      "piMapping": "extension tool_call handler in extensions/guard/index.ts",
      "acceptanceTest": "extensions/guard/test/block.test.ts::blocks rm -rf",
      "status": "VERIFIED",
      "critical": true
    },
    {
      "id": "GUARD-002",
      "sourceBehavior": "Hook timeout defaults to 60s",
      "evidence": "inference from docs example; not observed",
      "piMapping": "extension handler with AbortSignal timeout",
      "status": "INCONCLUSIVE",
      "gap": "Source harness not runnable here; default unconfirmed"
    }
  ]
}
```

## Fields

| Field | Required | Meaning |
|---|---|---|
| `id` | always | A stable ID matching `PREFIX-NNN` |
| `sourceBehavior` | always | The documented or observed contract |
| `evidence` | always | A document, fixture, trace, or observation |
| `piMapping` | always | The target mechanism and its entry point |
| `acceptanceTest` | when the status is VERIFIED | `path/to/test::name`. The path is relative to `--root` and must exist. |
| `status` | always | `VERIFIED`, `NOT VERIFIED`, `INCONCLUSIVE`, or `NOT APPLICABLE` |
| `gap` | when the status is NOT VERIFIED or INCONCLUSIVE | The exact mismatch or missing evidence. Leave it out when VERIFIED. |
| `reason` | when the status is NOT APPLICABLE | Why the specification excludes this requirement from the target |
| `critical` | optional | Marks requirements to call out separately in the report |

## Derived verdict

1. Any `NOT VERIFIED` makes the verdict **NOT VERIFIED**.
2. Otherwise, any `INCONCLUSIVE` makes it **INCONCLUSIVE**.
3. Otherwise, at least one `VERIFIED` makes it **VERIFIED**. A ledger containing only `NOT APPLICABLE` proves nothing, so its verdict is **INCONCLUSIVE**.

The `verdict` field must equal the derived verdict.

## Validator

`node scripts/validate-ledger.mjs <ledger.json> [--root <dir>] [--markdown]`

- Exit 0 means the ledger is valid. It prints `{verdict, counts}` as JSON, or the markdown table when `--markdown` is passed.
- Exit 1 means the ledger is invalid. It prints one `error:` line per problem on stderr.
- Exit 2 means a usage error or an unreadable file.

`--root` defaults to the ledger's own directory. Pass `--root .` when the acceptance-test paths are relative to the repository root.

A passing validator does not prove parity. It only proves the ledger is internally consistent. You must still check the ledger against `spec.md` for missing requirements and for tests that could pass without the behavior they claim to cover.
