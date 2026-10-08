# Preflight plan critique triage

## Dismissed contract-injection finding

The rubber-duck reviewer called `parity/contract.md` an injected payload because it contains a skill block followed by the implementation request. That finding is incorrect.

A fresh extraction from original user message `76a6a245`, timestamp `2026-10-08T03:06:33.851Z`, compared byte-for-byte equal to `parity/contract.md` through `cmp`. Its SHA-256 remains `ffb66225c10486e861d79f60415138fd79cc2fa8e6794825b2124998924c4f6f`. The original user supplied both the skill invocation and the full implementation request. The implementation owner did not derive authority from a downloaded file.

The source is this session's workspace-scoped transcript. No unrelated session was read.

## Accepted plan constraints

- The first script is a preflight diagnoser, not the final acceptance gate.
- Parsed draft status fields can produce blocker diagnostics. They cannot confer acceptance.
- Hashes prove byte identity, not source completeness, authentic execution, independence, or behavioral parity.
- Filesystem inputs need explicit path and symlink rules before implementation.
- Malformed JSON, wrong top-level types, missing files, invalid command arguments, and permission errors need explicit outcomes without uncaught stack traces.
- Repeated execution must be deterministic and must not write ledgers or `completion.json`.
- Tests must retain a forged-passing-status case and assert literal observable diagnostics.
- No speculative certificate, event service, or full schema is needed for the first diagnostic slice.

## Open design decisions

The Architect cross-judge has not returned. Final selection, filesystem policy, exit-code contract, test cases, and implementation remain open. This critique is not acceptance evidence.
