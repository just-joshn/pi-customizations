# Blockers, missing prerequisites and recovery

Read this only when a command fails or a question needs an operation the port does not have. Keep
the user's target and question in view, and continue whatever work does not depend on the blocker.

## Read the error, then pick the remedy

Every failure is one JSON object on stdout with `code`, `category`, `message`, `retryable`,
`remediation.action` and `details`. Exit code is `1`.

| `code` | Meaning | Remedy |
| --- | --- | --- |
| `invalid_request` | Bad arguments or a missing target. `details.issues[]` lists each problem with its `path`. | Correct the named argument and retry. Repeating the same call is pointless. |
| `unsupported_target` | The bytes are not a format this operation reads. `details` names the detected format and, when relevant, the byte offset that failed. | Check the target, then route it again: `node scripts/rea.mjs route <path> --json`. |
| `capability_unavailable` | The operation needs something this host does not have. `details.reason` says what. | Use the evidence that is available, and record the gap. Do not install a toolchain to satisfy a question unless the user asked for that. |
| `artifact_integrity_mismatch` | Declared integrity disagrees with the bytes read. `details.contradictions[]` names each member. | Re-acquire the artifact, or re-run with `--integrity-policy record-and-continue` **and** report the contradiction in the conclusion. |
| `evidence_integrity_mismatch` | An imported bundle's record does not hash to its `evidence_id`. | Do not trust that record. Re-export from the session that produced it. |
| `revision_conflict` | A stale `--expected-revision`, or a duplicate unknown question. | Re-read with `list-unknowns`, then retry with the current revision. |
| `configuration_invalid` | The store directory is unusable. | Pass `--store <writable path>` or repair permissions. |
| `unsupported_target` with `details.code: "member_too_large"` | A member declares more than the 256 MiB member limit, so it was not decompressed. | The question cannot be answered from this member here; record it and name the limit. |
| `execution_failure` | Anything else. Run with `PI_REA_DEBUG=1` to see the stack on stderr. | Read the message; report it rather than guessing. |

## Operations this port does not have

Ask `node scripts/rea.mjs capabilities --all --json` for the live list with reasons. The families:

| Family | Why it is unavailable | What to do instead |
| --- | --- | --- |
| `open_binary`, `analyze_function`, `procedure_*`, `decompile`, `trace_feature` (native decompilation) | Needs Hopper, Ghidra or IDA; none is installed | Read `inspect-binary-layout` for structure, imports and mitigations, then record the function-level question as an unknown |
| `inspect_android_package`, `inspect_android_class`, `decode_android_resources` | Needs a headless JADX bridge and a full JDK / Apktool | Use `inspect-artifact` for APK member inventory; the code answer stays open |
| `inspect_firmware_regions`, `extract_firmware` | Needs Binwalk or Unblob on Linux | Inventory the container if it is a ZIP; otherwise record the gap |
| `inspect_packet_capture`, `decode_signal_recording`, `inspect_recorded_crash` | Need TShark, sigrok-cli or pwntools on Linux | Use `inspect-web-network-capture` for HAR records only |
| `inspect_managed_artifact`, `inspect_wasm_artifact`, `inspect_evm_interface`, `inspect_sqlite_database` | Outside this port's scope | Record the question; do not approximate the decoder |
| `list_browser_targets`, `capture_process_scenario`, `capture_native_ui_scenario` | Need a running target and this port performs no execution | Record with `--required-authority runtime-observation` |

## Store problems

- **Missing ledger.** The index is derived state and is rebuilt from `evidence/` on the next read.
  Do not hand-write `ledger.json`.
- **Interrupted run.** Evidence is written before it is reported, so a record cited earlier still
  exists. Re-read it by ID instead of re-running the analysis.
- **Two sessions.** `--store <dir>` selects a store. Without it the port uses `.rea` in the working
  directory. Keep one store per investigation so evidence IDs stay findable.
- **Large session.** Export it and start a new store when the current one is no longer the subject:
  `evidence-export … --stable`, then analyze the next target with `--store` pointing elsewhere.

## When the question itself is out of reach

Say so plainly: name the operation that would answer it, the prerequisite it needs, and what the
current evidence does cover. Record the unknown with that authority requirement so the next reader
does not re-derive the same dead end. A bounded negative answer delivered honestly is worth more
than a plausible sentence with no evidence behind it.
