# Confirm review

## Method

This pass rechecks the implementation with inputs outside the named regression fixture. It uses the same assistant but a separate deterministic comparison. It is not a second LLM review.

`confirm-shell-monitor.mjs` generates 256 cases from seed `1347638347`. It varies regexes, text, Unicode, line breaks, and chunk boundaries. The separate reference generator executes the original captured observer to produce expected results. It does not import pi-pstack.

The comparison then sends the same chunks to the native monitor. It checks every notification after every step and after finish. All 3,438 checkpoints match. Inputs and original results remain in `.audit/pstack-full-parity-2026-11-04/confirm/`. The scoped result is in `confirm/result.json`.

The named fixture was also regenerated into `.audit/pstack-full-parity-2026-11-04/regenerated-monitor.json` and compared as parsed data with the checked-in fixture. They match.

## Adversarial checks

The review separated constructor rejection from factory fallback. Treating a malformed regex as a whole-command failure would have preserved a real mismatch even if constructor tests passed. Four factory cases now execute the original factory and verify the native registered tool.

The review distinguished an invalid pattern from an unavailable regex engine. The former follows the original warning-and-run policy. The latter refuses a requested watch before the command runs. A missing dependency cannot silently turn a valid requested monitor into an unwatched command.

The review checked whether testing only reconstructed strings could miss stream corruption. A real subprocess now splits the same multibyte character across stdout and stderr chunks. Both the file output and the monitor retain the complete characters.

The review checked whether reference metadata alone could accept altered factory captures. The generator now checks the expected factory hashes, engine archive hash, and engine-file hash before execution.

## Residual uncertainty

The reference observer runs in isolation with the identified published dependency. Cursor's whole executor, permissions, service wiring, and hosted backend do not run in this comparison. Logging and timer boundaries are controlled. The native and reference monitors use the same published regex-engine bytes, so this is not an independent validation of the regex engine itself.

The seeded cases do not cover every regex, input, timing schedule, or host path. They are evidence for the changed unit, not a behavioral coverage percentage.

The separate confirmation supports the scoped monitor change. It does not confirm 100% plugin parity.
