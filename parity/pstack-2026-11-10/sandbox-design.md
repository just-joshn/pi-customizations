# Linux read-only sandbox design

## Problem

The Linux read-only shell is intended to prevent filesystem writes and access to host Unix sockets while preserving network access. The current s390x filter cannot distinguish the address family in a multiplexed socket creation call, so it denies that call and prevents ordinary glibc network access. Separate experiments reported a Unix-datagram path through the current filter. The latter requires a reproducible regression test against the shipped implementation before a correction can be accepted.

The goal is to preserve both the security boundary and network capability. A network-disabled profile is not full parity. The sandbox is not a confidentiality boundary; existing documentation says the read-only process can read files and use the network.

## Usage

Callers continue to request a read-only shell through the existing Pi tool. They do not choose a kernel mechanism or coordinate a helper. A successful shell retains normal output, cancellation, TCP, and loopback behavior. If a secure profile cannot be established, the command must not silently run with weaker restrictions.

```ts
// Existing caller-facing operation.
const command = linuxReadonlyCommand(script, cwd);
// Pi's shell operation executes command and returns its output and exit status.
```

Tests exercise the same entry point with a host-side fixture and verify observable results. A separate s390x full-system test checks ordinary network clients, process pipes, and the Unix-socket boundary.

## Shape

Keep `linux-readonly-sandbox.ts` as the facade that selects and verifies the Linux sandbox and constructs the command. Keep architecture-specific kernel policy in one place. If the filter needs a richer rule representation, a pure internal module may compile that policy to filter bytes; its tests must use an independent oracle, not expectations generated from the same policy.

For mechanisms that require a supervisor, the facade owns startup, capability checks, failure handling, and teardown. The supervisor must enforce the same policy without duplicating its authority across independently maintained tables. A native helper is not excluded merely because it adds code; evaluate packaging, supported architectures, kernel prerequisites, and maintenance against the contract. Do not conceal implementation complexity in another language.

The s390x supervisor remains a prototype. Before adopting it, verify that the actual production filters and supervisor work together, that failures remain closed, and that process cancellation and concurrent requests preserve the boundary. A single loopback probe cannot prove arbitrary network access or all security properties.

## Synthesis decision

Candidate 1 provides the stronger starting point because it includes a route toward s390x network access and real-kernel experiments. Its supervisor is not approved for production on that evidence. Candidate 2 contributes adversarial filter cases and a simpler creation-time policy, but its architecture-only network capability claim is not a substitute for observed behavior.

The independent review found that the proposed filters are prototypes, not the shipped filter, and that one candidate's indexed s390x result file was an earlier failed run. Its later VM log is the relevant experimental evidence. It also found duplicated policy in the Python prototype and missing lifecycle, concurrency, and platform evidence. The candidate designs are at `/tmp/pstack-sandbox-architect/candidate-1/design.md` and `/tmp/pstack-sandbox-architect/candidate-2/design.md`; those temporary files are not durable release evidence.

Neither candidate's proposed network-disabled s390x fallback satisfies the original parity requirement. Do not present a fallback, warning, or stronger restriction as a verified equivalent when it removes required behavior. Do not introduce it as a silent fallback.

## Tradeoffs accepted

- We accept additional implementation and verification work to preserve both network behavior and the security boundary.
- We retain the existing fail-closed behavior until a replacement is demonstrated; this does not make the existing s390x behavior parity-complete.
- We treat separate real-kernel tests and independent expected outcomes as necessary, even when unit tests pass.

## Alternatives considered

- **Static filtering only.** It is simple and portable for arguments visible to the kernel filter, but the s390x multiplexed call hides the relevant arguments. It cannot by itself establish the requested behavior.
- **Supervisor-assisted enforcement.** It can handle calls the static filter cannot inspect. It adds a process, lifecycle and kernel requirements, and must be verified as a complete security boundary on supported hosts.
- **Network-disabled fallback.** It can reduce exposure but removes required network and potentially process behavior. It is not a parity solution.

## Open questions and risks

- Can a supervisor enforce the boundary across the supported Linux kernel and distribution matrix without new unsupported dependencies or weaker failure behavior?
- Can the helper avoid duplicate policy while preserving process isolation, cancellation, and correct concurrent operation?
- Do the actual shipped filter and a corrected implementation pass independently asserted real-kernel security and network tests on every required architecture?
- What other host services and inherited descriptors are reachable under the existing shared-network policy?
- Which experimental receipts can be reproduced and preserved in the repository without relying on temporary files or privileged assumptions?

## Next implementation step

Create a reproducible failing behavioral test for the reported Unix-datagram path using the actual sandbox, then verify the smallest correction against that test and the required process and network behavior. Develop the s390x parity mechanism as a separate gated unit; do not mark it verified until its security, lifecycle, and platform gates pass.
