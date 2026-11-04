# Reconstruction checkpoint

The goal is native Pi behavior for pstack and the dependencies its workflows actually use. This checkpoint records bounded observations. It does not close the reconstruction.

## Readonly shell

The original policy allowed every Unix socket. An actual Pi child connected to a disposable host service, which changed a file outside the child's filesystem sandbox. `readonly-boundary-baseline.txt` records the failing regression.

The policy now disables that exception. A dependency warning that Unix sockets are unrestricted prevents startup. `readonly-boundary-treatment-sanitized.txt` records three passing regressions. `installed-pi-readonly-boundary.txt` records two passing installed-Pi regressions. These establish failure-closed behavior on the current host, not a working restricted shell.

The strict helper cannot write `/proc/self/setgroups` on this host. The direct strict probe and a probe under an existing per-process AppArmor profile both failed. A separate direct-helper probe failed too. `sandbox-strict-probe.txt`, `sandbox-strict-profile-probe.txt`, and `sandbox-profile-premise.txt` retain those results. No global OS setting was changed. The profile experiment is not a deployment recommendation.

`make-verify-status-and-readonly.txt` records the final reconstruction run before PR preparation. The fresh `pr-make-verify.txt` run repeats its outcome. Both exit with an error at pi-pstack's coverage suite. That suite has 680 passing tests and five failing positive shell checks in three files, across 46 files total. Those assertions remain intact. The typecheck and preceding repository checks passed. No result for later packages is inferred after that stop. `make-verify-readonly-strict.txt` preserves the preceding 675-pass, five-failure run before the added plan regressions. `make-verify-handoff.txt` is an earlier successful full run with 677 pi-pstack tests, before the safety change.

The five failing checks require successful restricted command execution. A compatible host must run those checks before the Unix-socket repair can be considered fully verified. A failure to run the command is not a substitute for proving that legitimate commands work while forbidden operations fail.

## Benny credentials

Readonly removes MCP tools and restricts shell operations. It does not remove inherited credentials or restrict the ordinary read tools to non-secret files.

The baseline observed a fake Slack token through the readonly shell. The later regression gives the child a minimal environment containing only test paths, offline settings, and a fake token. It reads its own Linux process environment through the actual read tool and finds that token. No real credential is required by that probe.

Setup now stops without separate credential isolation. Operational instructions keep analysis and code work in the coordinator when that isolation cannot be established. This is a correction to agent instructions, not proof that a live model followed them or that an authenticated Slack journey is safe.

Another instruction-level inconsistency remains open. Both upstream templates provide `message_ts`, while both operational skills fall back to `trigger.ts` when `thread_ts` is absent. The native templates retain that shape. An empty thread timestamp also needs an explicit interpretation. No host normalization or real-model handling of that discrepancy has been observed. Do not treat the webhook fixture tests as proof of this workflow.

## Reviewed plan status

A reviewed todo may omit its optional status. The parser imports it as pending, but the old synchronizer skipped that absent scalar. A successful completion therefore reimported as pending. `plan-missing-status-observation.txt` records the direct observation. `plan-missing-status-baseline.txt` records four failing file regressions and one failing actual Pi RPC regression, alongside the already-passing explicit-status RPC case.

The synchronizer now represents replacements and insertions as ordered text edits. It adds a missing status at the start of the existing block or flow mapping. It does not reserialize the document. `plan-missing-status-treatment.txt` records all six cases passing. `plan-missing-status-suites.txt` records 48 passing plan and todo tests across three files. The typecheck and targeted Biome check also pass. `installed-pi-plan-status.txt` records both RPC cases passing against installed Pi. Pending defaults remain a byte-preserving no-op. `plan-missing-status-noop-baseline.txt` preserves the regression caught while refining the repair, and the earlier treatment and suite receipts are retained with `-initial` names. These receipts do not resolve the separate Linux sandbox failure.

## Other bounded review

The changed runtime diff was read in full, including the core and lifecycle changes. The new shared process-lock module was read in full. Relevant surrounding plan and loop sections were reviewed for path validation, reviewed-file import, one-time launch consumption, branch restoration, readonly synchronization, scheduling, and shutdown. This is not a complete audit of every runtime module or interleaving. The changed-test diff and new fixtures received a direct local pass during PR preparation. `pr-preparation.md` records that scope. No independent code or comment reviewer was used.

The extracted schema inventory was read through its end. The complete normalized probe file and shipped host implementations still need semantic review. Cursor's observed dynamic Subagent schema is narrower than pstack's requested arguments. That is a visibility boundary, not proof of global absence.

Both the direct TodoWrite query and the namespace query report `minItems: 2` and require each item's content and status. Pi permits one item and status-only merges. That difference is recorded, not silently changed. Enforcement on the reference host was not probed, and the workflow intent must be reconciled with the schema before claiming equivalence.

The different root license owners are not a missing-notice defect. The README distinguishes the port license from vendored notices, and `licenses/pstack.LICENSE` is byte-identical to upstream. Its SHA-256 is `bc957ca6bee02792566a1a028d105e02e247c6e77cf057061674273da77b200e`.

## Evidence identity

`source-inventory-readonly-native.json` and `adaptation-diff-readonly-native.patch` preserve the final reconstruction snapshot before PR preparation. The labeled `-pr` snapshot captures the later status-document update without replacing those inventories. The snapshot hashes 706 native package files, including tests and untracked authored additions. It also hashes the native Pi CLI, session and extension host implementations, installed sandbox package, Linux wrapper, helper resolution, and native seccomp helper. Counterpart counts remain 498 identical and 71 adapted pstack files, 20 identical and seven adapted team-kit files, and 11 SDK dependency candidates. Counts establish inventory shape, not semantic coverage.

`sandbox-helper-provenance.txt` records the fetched version-tagged helper source and installed binary hashes. The tagged C source explains the observed namespace refusal. It is not a reproducible-build proof that the installed binary came from those exact source bytes.

The workflow and host reconstruction milestones remain incomplete. Branch preparation and publication are recorded separately in `pr-preparation.md`. A later user request bumps only pi-pstack to `0.15.36-pi.13`. The captured inventories and test receipts predate that metadata-only change. No deployment or merge is part of either request.
