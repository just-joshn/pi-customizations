# Pair comparator specification

## Authority and input

This comparator is an independent verification artifact. It consumes the path to one schema-1 `pair.json` written by `recordPair`. It reads each side's referenced `identity.json` and `events.jsonl`; it does not execute either program.

The comparison has three possible verdicts:

- `pass` means both sides were present, evidence preconditions agreed, and the unexplained-difference count was zero.
- `fail` means the evidence was comparable and at least one stable observable differed.
- `refused` means the evidence could not support a comparison. A refusal is never a pass, even if the available observables match.

The report always includes `pass`, `hasUnexplainedDifferences`, difference counts, refusal reasons, raw differences, applied normalizations, and unexplained differences. A bare success token is not an output format.

## Preconditions

The comparator refuses when:

1. `cursor` or `pi` is absent from the pair.
2. either side's attempt files cannot be read.
3. `steps` is absent or is not an array.
4. the pair-level fixture digest and the two identity fixture digests are not exactly equal, including `null`.
5. the ordered action streams reconstructed from the two event logs have different SHA-256 digests.

Refusal takes precedence over pass or fail. When both attempts remain readable, refusal does not suppress their observable differences.

## Stable observables

### Ordered input actions

`pair.steps` is the canonical ordered input. Each step expands in recorder execution order to `resize`, `send`, then `cancel`. `waitFor` controls dispatch timing but is not itself user input.

Each side's event log reconstructs actions from `resize`, `input_dispatched`, and the first `cancel_requested` event. A send compares its bytes and origin exactly. A resize compares rows and columns exactly. Cancellation compares its position exactly. Any missing, extra, reordered, or changed action is unexplained. If the two actual action digests differ, the comparison is also refused.

### Process outcome

`outcomeOf(events)` is compared as an exact structured value. Exit code, signal, launch failure errno, cancellation result, and interrupted last sequence are not normalized.

### Output bytes

All `output` payloads are Base64-decoded and concatenated in event order. The raw comparison is byte-oriented, not Unicode-oriented. Every unequal positional byte is retained. A missing byte is represented as `null`.

Each raw byte difference records the global output offset and, where a byte exists, the source event `seq` and byte offset within that output event. The raw list is retained even when an allowlisted normalization explains the difference.

The comparator then applies the fixed normalization allowlist independently to each complete byte stream and compares the resulting bytes. Every applied replacement records its side, rule, raw value, replacement, source event `seq`, and raw global byte offset. Remaining unequal bytes are unexplained output differences.

This is positional comparison. Insertions and deletions therefore retain all unequal positions through the end of the longer stream rather than collapsing them into one edit.

## Normalization policy

`normalization-allowlist.json` is the entire normalization authority. The implementation has no general-purpose UUID, number, path, timestamp, whitespace, ANSI, line-ending, text, or semantic normalization.

Allowlisted values are derived from the evidence, never discovered by pattern matching output:

- `attempt-id` uses the recorder-generated identity attempt ID.
- `process-id` uses the operating-system-assigned PID from `process_started`.
- `recorder-utc-timestamp` uses exact recorder event UTC stamps. Its replacement retains the event sequence.
- `recorder-monotonic-timestamp` uses exact recorder monotonic samples. Its replacement retains the event sequence.
- `equivalent-fixture-path` uses exact identity fixture paths only when both fixture digests are equal and non-null.

Replacement is exact byte matching. Arbitrary timestamps, paths, UUIDs, numbers, durations, model names, roles, failures, actions, decisions, exit details, and timing statements are untouched. Normalization never removes events or input actions. Adding a rule requires reference evidence that the source field is run-specific and verifier review.

## Counts and interpretation

`rawOutputDifferences` counts retained unequal raw byte positions. `normalizations` counts applied allowlisted occurrences on both sides. `inputDifferences` and `outcomeDifferences` count structured mismatches. `unexplainedDifferences` is the sum of input, outcome, and post-normalization output differences.

Raw differences are evidence, not automatic failures after normalization. Applied normalization entries explain only the exact occurrences they replace. A pass requires no refusals and exactly zero unexplained differences.

Different programs are expected to differ when their user-visible bytes differ. In particular, the recorded Cursor Agent and Pi `--help` pair is a failure with many unexplained byte differences; the comparator has no product-name or help-text exception.

## Reference interface

`comparePair(pairPath, options?)` returns the report. Running `node comparator/compare.mjs PATH/TO/pair.json` writes the same report as JSON and exits zero only for `pass`; `fail` and `refused` exit nonzero.
