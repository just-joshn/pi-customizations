# pi-rea parity (rea-agents 6.8.0)

Verification notes and offline harnesses for `extensions/pi-rea` against the published `rea-agents@6.8.0` surface. The extension does not depend on `rea-agents`. Oracle captures here are for comparison only.

## Differential harness

Compares each implemented kernel tool that has a safe offline fixture:

1. Invoke the pi-rea tool handler in-process (no Pi TUI).
2. Invoke `npx -y rea-agents@6.8.0 <cli> --format json --full-output` (MCP `tools/call` is available in the helper if a CLI command is missing).
3. Write both outputs and a normalized diff under `evidence/differential/<case-id>/`.
4. Fail on Evidence-envelope regressions. Document known field-level deviations in `evidence/differential/mismatches.json` instead of ignoring them.

### Run

From the repo root (requires Node ≥ 22, Bun, Go for Mach-O fixtures, network for the first `npx` pull):

```bash
bun parity/pi-rea/scripts/run-differential.mjs
```

Thin/fat Go Mach-O fixtures under `fixtures/targets/fixture-go-macho*` are built on demand and gitignored. Other fixtures (plist, PE, ZIP, HAR, notepad app) are already in-tree.

### Outputs

| Path | Meaning |
| --- | --- |
| `evidence/differential/<case>/pi-rea.json` | Port tool result (`evidence` or `error`) |
| `evidence/differential/<case>/rea-agents.json` | Oracle CLI result |
| `evidence/differential/<case>/diff-summary.json` | Normalized diff + status |
| `evidence/differential/summary.json` | Pass/fail counts for the run |
| `evidence/differential/mismatches.json` | Allowlisted field paths with reasons |

Exit code `0` means every case passed or only had documented mismatches. Exit code `1` means a contract break or an undocumented field diff.

### Covered tools

`inspect_plist`, `inspect_macho`, `list_architectures` (thin + fat), `inspect_pe_resources`, `analyze_javascript_application`, `inspect_artifact`, `inspect_binary_layout`, `inspect_go_binary`, `inspect_web_network_capture`.

On Darwin, `inspect_binary_layout` is an expected kind mismatch: the oracle refuses the Linux-only pwntools profile while pi-rea still returns Evidence from its in-process ELF reader.
