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

## Real-driver worker measurements

The real driver adds a measurement-only Pi extension through its container provider-package list. The scripted driver and product container code are unchanged. The extension captures the live Pi process at `session_start`, after fixture initialization and before model work. It sends the names-only record to a real-driver HTTP receiver. The receiver stores validated records in a private temporary directory outside the sandbox. Only the extension package is mounted in the container. Its capture directory is an unmounted sibling, not a worker output or run directory. After stopping the parent and workers, teardown collects these records even after `docker run --rm` removes the container. Only then does it write the aggregate evidence into the sandbox. The receiver and its temporary directory are removed on completion. A failed delivery leaves the probe unavailable and does not crash Pi.

The capture compares the startup environment from `/proc/self/environ` with Pi's effective `process.env`. Linux retains the startup bytes after JavaScript deletes a variable, so these measurements answer different questions. `present` lists forbidden startup variables except the exact synthetic fixture `GH_TOKEN`. `fixturePresent` lists that synthetic token's authorized `GH_TOKEN` name. `fixtureMatches` lists every measured name whose startup value exactly equals the fixture token, without exempting unexpected names. A fixture-valued `PSTACK_CONTAINER_FORGE_TOKEN` therefore remains in `present` and still fails isolation. `effectivePresent` lists forbidden variables still available to Pi after initialization. A non-fixture startup token or any effective token fails isolation. The fixture token is supplied by `forgeEnv` as `PSTACK_CONTAINER_FORGE_TOKEN`, resolved by product `forgeToken`, delivered as `GH_TOKEN` through the stdin preamble, and removed by the fake-forge extension. Token classification uses its exact fixture-defined value, never its prefix or name alone.

Evidence contains credential names, the Pi PID, the capture stage, and a verdict. It contains no credential values. The live-container regressions run real Pi and check clean startup, stdin-injected contamination, fixture-token removal, retained fixture tokens, and unavailable capture. The host diagnostic locates the worker's Node executable through `/proc/<pid>/exe`, since Pi changes its process title.

A missing or invalid capture is an INCONCLUSIVE credential measurement only. It does not mark the run as crashed, invalidate other checks, or claim a leak. A measured leak is a failing family result and forces CLI exit 1, even if another check is inconclusive.

## Ambient source-token forwarding

The round-8 container assignments explicitly chose `env: 'minimal'`. The generic launch snapshot nevertheless copied every ambient `PSTACK_*` variable, including the fixture's `PSTACK_CONTAINER_FORGE_TOKEN`. The host retained that prefix and sent the extra copy through its stdin preamble. This was product forwarding beyond the container credential rule, not a request for `env: 'inherit'` and not a stale tmux environment.

Minimal container snapshots now omit ambient `PSTACK_*`. The parent still supplies launch controls and capability payloads explicitly, including `GH_TOKEN` for forge. Local workers and explicit `env: 'inherit'` retain their documented behavior. The mounted scripted-scenario fixture supplies its own path through an extension instead of ambient inheritance.

The sentinel regression in `tests/container/forge.test.ts` reads the live Pi process's startup environment through `/proc`, both with and without forge. The provenance regression injects the exact fixture token under `PSTACK_CONTAINER_FORGE_TOKEN`, removes it from Pi's effective environment, and still requires a failing startup verdict with `fixtureMatches` naming that variable. A different token is never fixture-classified. Neither test records credential values.

## Limits

The capture establishes the environment at startup, not every later tool invocation. The capture files are not mounted or shown to either model. The worker can inspect its measurement extension and imitate its HTTP request, so this remains evidence about cooperative workers, not tamper-proof evidence against a malicious worker. The fixture capability is test state, not a security credential. These checks do not establish a security boundary against a malicious worker. The network probe remains recorded evidence rather than an external-network dependency in the permanent scripted suite.
