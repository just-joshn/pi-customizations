# Open items: designed workflow

## Definition of done

Each open item from PR 201 is either VERIFIED closed by a run on the real artifact, or stays open with its blocker named and evidence kept. A fallback, warning, or documentation change does not close an item that needs behavior. Nothing is called parity from a table.

## Rigor

High for the sandbox items, because they are a security boundary and a wrong filter either leaks or breaks commands. Low for the release item, which is reversible. One-way doors: committing a native binary, and changing how every Linux shell command is launched.

## Units, riskiest unknown first

| Unit | Item | Why this order | Gate |
| --- | --- | --- | --- |
| 1 | Inherited descriptors reach host Unix sockets | Cheap to test and a launch-path change affects every Linux command | Failing test, fix, real-kernel rerun of the reviewer repro, ordinary programs still work |
| 2 | musl or Alpine, Go and static binaries, x64 kernel | Verification only, no design risk. The x64 kernel must be full-system QEMU because Rosetta cannot test seccomp | The existing harness cells pass or the failure is a recorded finding |
| 3 | CHANGELOG and version | Mechanical, follows the shipped behavior | Follows the repo's last release commit |
| 4 | s390x broker | Largest and the only way to close the s390x bypass, so it gets a checkpoint first | Real s390x kernel run of the production chain, races, abort, stacked filter |

## Out of reach, stays open

- Parity with Cursor pstack needs matched-model runs that Cursor usage limits block. Re-probe once, do not substitute a different model.
- The sandbox is not a confidentiality boundary. That is a documented property, not a defect. Verify the README says so.
- SEQPACKET stays refused unless a real program needs it.

## Fan out

None for units 1 to 3, because they touch one file and one harness. Unit 4 gets an independent judge after implementation.
