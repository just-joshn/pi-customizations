# Acceptance verifier re-review transcript

All commands ran against disposable copies except the read-only hash and clean-verify commands. The owner worktree source was not edited.

## Baseline identity

Command:

```sh
git status --short
shasum -a 256 \
  parity/acceptance/tools/verify-acceptance.mjs \
  parity/acceptance/tools/selftest.sh \
  parity/acceptance/MANIFEST.sha256 \
  parity/acceptance/setup-pstack/definitions.json \
  parity/acceptance/setup-pstack/configurations.json \
  parity/acceptance/setup-pstack/record-hashes.json
git -C /Users/josh-desktop/src/experiments/plugins rev-parse HEAD
```

Output:

```text
?? parity/
26c5141784cba4130962a7817821e5b03d6522982dec73b6309a173c19770599  parity/acceptance/tools/verify-acceptance.mjs
85814217abf06cd330f11b1e095481967cc557807da7eb975742a2d30bb065b1  parity/acceptance/tools/selftest.sh
10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c  parity/acceptance/MANIFEST.sha256
e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4  parity/acceptance/setup-pstack/definitions.json
3755a29140cdbf700f01eadd5e268b3abc459152c619bd0037bfe70cc355a80f  parity/acceptance/setup-pstack/configurations.json
4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238  parity/acceptance/setup-pstack/record-hashes.json
ccb5507cec1546dc88135c1139c811e6c59115ba
OWNER_STATUS_EXIT=0
DIGESTS_EXIT=0
REFERENCE_HEAD_EXIT=0
```

## Selftest

Command:

```sh
sh parity/acceptance/tools/selftest.sh \
  /Users/josh-desktop/src/experiments/plugins \
  /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity
```

Output:

```text
ok unmodified copy is structurally consistent DRAFT with no authorization
ok unmodified copy matches its external pin
ok forged freeze rehash is refused
ok forged freeze rehash leaves recorded hashes
ok forged freeze rehash leaves the manifest
ok forged freeze verify is refused
ok same-family reviewers and an existing failure capture cited as a run are refused
ok distinct-family reviewers still lack an authenticated transition
ok distinct non-implementer families raise no family finding
ok dropped forbidden effects cannot be reblessed
ok refused rebless leaves recorded hashes
ok deleted definition cannot be reblessed
ok removed configuration value cannot be reblessed
ok unreviewed denominator claim cannot be reblessed
ok edited implementation-owner identity cannot be reblessed
ok declared authority is not authentication
ok new DRAFT record carrying review claims is refused
ok a new DRAFT record is appended and recorded
ok hand-edited hash ledger evades the local check and stays unauthorized
ok external pin catches a hand-reblessed dropped obligation
ok external pin catches a reblessed governance edit
ok weakened exact label excerpt
ok wrong source locator
ok unknown configuration
ok tampered reference evidence
ok unrecorded governance edit
ok symlinked MANIFEST.sha256 is refused on write
ok symlinked MANIFEST.sha256 leaves the external file untouched
ok symlinked setup-pstack/record-hashes.json is refused on write
ok symlinked setup-pstack/record-hashes.json leaves the external file untouched
ok trailing newline on record-hashes fails the pinned digest
ok non-integer source locator is refused
ok trailing --expect-manifest-sha256 without a value is refused
ok empty --expect-manifest-sha256 value is refused
ok malformed --expect-manifest-sha256 value is refused
selftest passed
SELFTEST_EXIT=0
```

## Focused regressions

Commands:

```sh
sh parity/acceptance/review/regressions/ledger-byte-drift.sh \
  /Users/josh-desktop/src/experiments/plugins \
  /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity
sh parity/acceptance/review/regressions/invalid-locator.sh \
  /Users/josh-desktop/src/experiments/plugins \
  /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity
sh parity/acceptance/review/regressions/missing-pin-arg.sh \
  /Users/josh-desktop/src/experiments/plugins \
  /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity
```

Output:

```text
ok ledger-byte-drift rejected (exit 1)
  FAIL setup-pstack/record-hashes.json bytes do not match the canonical recorded hashes
REGRESSION_EXIT=0

ok invalid-locator rejected (exit 1)
  FAIL ACC-SETUP-BADLOC has invalid locator not-a-line; positive ordered integer locators only
REGRESSION_EXIT=0

ok missing-pin-value rejected (exit 1)
  --expect-manifest-sha256 requires a sha256 hex digest
ok empty-pin-value rejected (exit 1)
  --expect-manifest-sha256 requires a sha256 hex digest
ok malformed-pin-value rejected (exit 1)
  --expect-manifest-sha256 value is not a sha256 hex digest: not-a-hash
REGRESSION_EXIT=0
```

## Clean pinned verify

Command:

```sh
node parity/acceptance/tools/verify-acceptance.mjs \
  --reference-root /Users/josh-desktop/src/experiments/plugins \
  --parity-root /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity \
  --expect-manifest-sha256 10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c
```

Output:

```text
{"kind":"acceptance-structural-check","structural":"PASS","authorization":"NONE","scope":"DRAFT integrity only. Not review, freezing, custody, evidence truth or acceptance.","partition":{"status":"DRAFT","definitions":43,"configurationCells":92,"denominatorComplete":false},"externalPin":"matched","openBlockers":["NO_AUTHENTICATED_TRANSITION_AUTHORITY","NO_REFERENCE_RUN_REGISTRY","NO_EXTERNAL_CUSTODY","DENOMINATOR_INCOMPLETE","FINAL_ACCEPTANCE_GATE_ABSENT"],"digests":{"definitions":"e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4","recordHashes":"4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238","manifest":"10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c"}}
CLEAN_VERIFY_EXIT=0
```

## Independent output-containment attacks

The exact commands are preserved in `replay.sh`.

Output:

```text
CASE=final-output-symlink
exit=1 before=1ed58b98ad593578ad49cfd92f983a39be0647c16ec1514041d1e071364d792c after=1ed58b98ad593578ad49cfd92f983a39be0647c16ec1514041d1e071364d792c changed=no
FAIL MANIFEST.sha256 is a symlink; hash files must be regular files inside the acceptance root
CASE=manifest-hardlink
exit=0 before=45a489ade3929b1766684380cff2ddbb20acfe636c0b33fd2f407d6e7feb28e4 after=10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c changed=yes
{"kind":"acceptance-structural-check","structural":"PASS","authorization":"NONE","scope":"DRAFT integrity only. Not review, freezing, custody, evidence truth or acceptance.","partition":{"status":"DRAFT","definitions":43,"configurationCells":92,"denominatorComplete":false},"externalPin":"absent","openBlockers":["NO_AUTHENTICATED_TRANSITION_AUTHORITY","NO_REFERENCE_RUN_REGISTRY","NO_EXTERNAL_CUSTODY","DENOMINATOR_INCOMPLETE","FINAL_ACCEPTANCE_GATE_ABSENT","EXTERNAL_PIN_ABSENT"],"digests":{"definitions":"e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4","recordHashes":"4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238","manifest":"10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c"}}
CASE=symlinked-output-parent
exit=0 before=69ca4d88122b17d5c84169b8f99c86b70a344ea59a5808c88042fc070f305a57 after=4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238 changed=yes
{"kind":"acceptance-structural-check","structural":"PASS","authorization":"NONE","scope":"DRAFT integrity only. Not review, freezing, custody, evidence truth or acceptance.","partition":{"status":"DRAFT","definitions":43,"configurationCells":92,"denominatorComplete":false},"externalPin":"absent","openBlockers":["NO_AUTHENTICATED_TRANSITION_AUTHORITY","NO_REFERENCE_RUN_REGISTRY","NO_EXTERNAL_CUSTODY","DENOMINATOR_INCOMPLETE","FINAL_ACCEPTANCE_GATE_ABSENT","EXTERNAL_PIN_ABSENT"],"digests":{"definitions":"e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4","recordHashes":"4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238","manifest":"10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c"}}
ATTACK_COMMAND_EXIT=0
```

## Replay artifact

Command:

```sh
sh parity/research/acceptance-verifier-rereview-001/replay.sh
```

The script reran the selftest, all three supplied focused regressions, the clean pinned verify, and all three containment attacks. It exited successfully because it observed the expected closed cases and reproduced the two unsafe write cases.

```text
REPLAY_EXIT=0
```

## Final write-fence verification

Commands:

```sh
shasum -a 256 \
  /private/tmp/pi-pstack-parity-acceptance-owner/parity/acceptance/tools/verify-acceptance.mjs \
  /private/tmp/pi-pstack-parity-acceptance-owner/parity/acceptance/tools/selftest.sh \
  /private/tmp/pi-pstack-parity-acceptance-owner/parity/acceptance/MANIFEST.sha256 \
  /private/tmp/pi-pstack-parity-acceptance-owner/parity/acceptance/setup-pstack/definitions.json \
  /private/tmp/pi-pstack-parity-acceptance-owner/parity/acceptance/setup-pstack/configurations.json \
  /private/tmp/pi-pstack-parity-acceptance-owner/parity/acceptance/setup-pstack/record-hashes.json
shasum -a 256 \
  parity/requirements.json \
  parity/configurations.json \
  parity/progress.md \
  parity/mismatches.json \
  parity/dependencies.json \
  parity/source-lock.json \
  parity/completion.json
git status --short -- \
  parity/research/acceptance-verifier-rereview-001 \
  parity/briefs/reports/u-acceptance-verifier-rereview-001-report.md \
  parity/briefs/u-acceptance-verifier-rereview-001.md
```

Output:

```text
26c5141784cba4130962a7817821e5b03d6522982dec73b6309a173c19770599  parity/acceptance/tools/verify-acceptance.mjs
85814217abf06cd330f11b1e095481967cc557807da7eb975742a2d30bb065b1  parity/acceptance/tools/selftest.sh
10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c  parity/acceptance/MANIFEST.sha256
e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4  parity/acceptance/setup-pstack/definitions.json
3755a29140cdbf700f01eadd5e268b3abc459152c619bd0037bfe70cc355a80f  parity/acceptance/setup-pstack/configurations.json
4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238  parity/acceptance/setup-pstack/record-hashes.json
OWNER_FINAL_DIGESTS_EXIT=0

32f143d9d0468145ee570b7a42cb5630497665e6134a00572d790759620f7d71  parity/requirements.json
d2c146c89f528ed67fa7bcc54147133014b16655c4f605e3bbf7991e0a252743  parity/configurations.json
18a7a6ec665503cf4500f7a9aac04b2b1e8274df22f4102d6d8f8a5b7092ff8b  parity/progress.md
db1ccadd9c3a5c6901713b8bb02c73021cf09f707dc4510d60a5740aa92dae13  parity/mismatches.json
91a893d8006119e995adde19977f9020445745bf3cee06906ed90169e10b4f5a  parity/dependencies.json
321602063772f5f6ced52cb8e3490e64e894ec1537a289bf2fb96275e1c49c6e  parity/source-lock.json
45bbb3beb032e07a7b2523c2052ac29566568d02e55a21a58e67049568e1a299  parity/completion.json
LEDGER_FINAL_DIGESTS_EXIT=0

?? parity/briefs/reports/u-acceptance-verifier-rereview-001-report.md
?? parity/research/acceptance-verifier-rereview-001/
OWNED_OUTPUT_STATUS_EXIT=0
```

The final owner and ledger digests match their baselines. The only task-owned paths reported by the scoped status check are the permitted report and research directory.
