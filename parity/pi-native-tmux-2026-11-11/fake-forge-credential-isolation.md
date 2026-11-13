# Fake-forge container credential isolation

The scripted shipping family runs `tests/workflow-parity/fixtures/credential-isolation.mjs` in its Docker verifiers. This tests fixture isolation, not a requirement that real-model verifiers must perform. Real-forge scenarios do not run this fake-forge probe.

## Defect and fix

The initial probe found the synthetic `FORGE_TOKEN` in `GH_TOKEN`. Git's HTTPS credential helper returned that synthetic token. No operator credential leak was observed, but the requested token-absence contract failed.

The fake-forge Pi extension now converts that exact synthetic token to fixture capability state, removes forge-token environment variables, and removes its GitHub credential helper. Fake CLI writes still require the capability. Removing it makes a comment fail without posting. Product container code is unchanged.

## Runtime evidence

On 2026-11-13, real Docker verifier workers passed these assertions:

- `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, and `SSH_AUTH_SOCK` are absent.
- The checked gh hosts files, operator keychain, and `security` executable are inaccessible. The mount table exposes no operator home, gh config, keychain, or SSH agent.
- Both real `/usr/local/bin/gh auth status --hostname github.com` and the fake shim's explicit GitHub-host query fail.
- `git credential fill` for the HTTPS sandbox repository returns no username or password with terminal prompts disabled.
- Removing the fixture capability makes a fake PR comment exit 4. Normal verifier comments still succeed.

A separate recorded container probe ran `git ls-remote https://github.com/just-joshn/pstack-parity-sandbox`, which exited 0 because the repository is public. A credential request for that same host and path with `operation=push` exited 128 and returned neither username nor password. No push was attempted. HTTP `ls-remote` is a read operation, not a test of push authorization.

Evidence is under `/Users/josh-desktop/src/personal/pi-native-pstack/real/u39-evidence/followups/item2/`. Initial sessions retain the red findings. `family-green.log` records the permanent probe, and `network/probe-result.txt` records the separate network probe. `network/family.log` records 23 passing shipping checks and detected negative cases. `family-no-forge.log` records 16 passing no-token checks.

## Limits

The fixture capability is test state, not a security credential. These checks do not establish a security boundary against a malicious worker. The network probe remains recorded evidence rather than an external-network dependency in the permanent scripted suite.
