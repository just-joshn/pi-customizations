# Acceptance owner checkpoint

This is a continuation note. It is not acceptance or completion.

## State

- Partition `setup-pstack` is DRAFT with 43 records and 92 declared configuration cells. `denominatorComplete` is false.
- `setup-pstack/definitions.json` is byte-identical to the original draft, sha256 `e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4`.
- The 43 record hashes in `setup-pstack/record-hashes.json` equal the original values.
- The original manifest was `78db6d2f1d6df138c670e18df6a8000f12434e39eed15489db91fdbe20807d80`. The current manifest digest is printed by the verifier and reported to the parent. The checkpoint cannot hold it because the manifest covers this file.
- Nothing is committed. `git status` shows `parity/` untracked on branch `parity/acceptance-owner`.

## Verifier repair

The parent showed that the original verifier passed a copy with every record FROZEN, `implementation-owner` review metadata in the `openai` family, run id `nonexistent-reference-run` and an incomplete denominator. `--write-hashes` reblessed it. There were two root causes. `checkDefinitions` treated truthy review fields as a valid promotion. Write mode also overwrote recorded hashes without comparing them.

The repaired verifier separates a structural result (`structural: PASS`) from authorization (`authorization: NONE`). It rejects every promotion and refuses to change or drop a recorded entry. It records partition, configuration and governance hashes, and it compares against an optional external manifest pin.

`review/selftest-red-original-verifier.txt` holds the self-test run against the original verifier. That run failed 20 checks. The repaired verifier passes all 26.

## Runtime receipt

Harness metadata for this session reports provider `claude-subscription`, model `claude-opus-5-5` and thinking level `high`. Those values come from `PI_PROVIDER`, `PI_MODEL` and `PI_REASONING_LEVEL`, from the session `model_change` entry `7ad1a485` and `thinking_level_change` entry `31b97ca7`, and from the provider and model fields on the session's assistant messages. Pi session id `01a119b0-d40e-7065-ade8-7465e4042835`, task `59c72bcb-79c0-4913-8a70-e1736cd355ff`. This is runtime metadata. It does not authenticate the physical service or model.

## Open blockers

- No external custody. The implementation owner can write this directory as the same OS user.
- No authenticated review records and no second reviewer on another family.
- No authenticated registry of successful reference runs. Cursor reference runs are blocked by `included_usage`.
- The denominator is incomplete. See `open-queue.json`.
- The full final acceptance gate does not exist.

## Next action

The parent stores the reported manifest sha256 outside this directory and runs a pinned copy of the verifier with `--expect-manifest-sha256`. The acceptance owner continues defining records from `open-queue.json` as additive DRAFT records.
