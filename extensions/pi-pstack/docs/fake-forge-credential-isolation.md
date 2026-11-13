# Fake-forge container credential probe

The goal is to prove that a fake-forge container worker cannot authenticate to GitHub as the operator. A scripted `shipping` family ran real Pi workers in OrbStack containers on 2026-11-13. No GitHub push was attempted.

## Requested assertions and observed results

The requested stronger assertion, that all forge token variables are absent and Git returns no credential, is **not verified**. It is false for the current fake-forge fixture. This is not an observed operator credential leak.

- `GH_TOKEN` contains exactly `FORGE_TOKEN` from `tests/workflow-parity/fixtures/forge.ts`. This is a synthetic fixture value, not an operator credential.
- `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, and `SSH_AUTH_SOCK` are absent.
- The worker cannot see `/root/.config/gh/hosts.yml`, `$HOME/.config/gh/hosts.yml`, `/Users/josh-desktop/.config/gh/hosts.yml`, `/Users/josh-desktop/Library/Keychains`, or `/usr/bin/security`.
- `/proc/self/mountinfo` contains the Pi installation, package, fixture forge, scenario, and worker output mounts. It contains no operator home, gh config, keychain, or SSH agent mount.
- `gh` on PATH is the fixture shim. `gh auth status --hostname github.com` exits 0 and prints `Logged in to github.com (fake forge)`. This is not a real authentication check.
- The real binary is `/usr/local/bin/gh`. Its `auth status --hostname github.com` exits 1 and reports `The token in GH_TOKEN is invalid.` The first probe tried `/usr/bin/gh`, which does not exist. The second probe located and ran the actual binary.
- `git credential fill` for the HTTPS GitHub repository exits 0 and returns `username=x-access-token` with the synthetic fixture token as its password. It does not return an operator credential.
- `git ls-remote https://github.com/just-joshn/pstack-parity-sandbox` exits 0. That repository is publicly readable. Successful listing is not proof of authenticated access.
- `git ls-remote --upload-pack=git-receive-pack` also exits 0, but Git warns `setting remote service path not supported by protocol`. The HTTP trace confirms `service=git-upload-pack`, not a receive-pack request. This command does not establish push authorization.

The root of the synthetic credential is deliberate fixture wiring. `forgeEnv` sets `PSTACK_CONTAINER_FORGE_TOKEN` to `FORGE_TOKEN`. A verifier requests `capabilities.forge`. `src/container.ts` places that token in `GH_TOKEN` and installs a Git credential helper that returns it. Removing the synthetic capability would change the fixture rather than repair a proven leak. No product change or weakened absence assertion was made.

## Recorded commands and artifacts

Artifacts are local to this verification machine at `/Users/josh-desktop/src/personal/pi-native-pstack/real/u39-evidence/followups/item2/`.

- `credential-isolation-probe.mjs` contains the exact second probe commands. It prints variable classifications rather than operator token values and replaces the synthetic fixture value in command output.
- `probe-session.json` contains the first worker's raw probe tool call and result.
- `probe-second-session.json` contains the second worker's raw probe tool call and result, including the real gh failure and HTTP trace.
- `family.log` and `family-second.log` contain the family checker and negative-case results. Both commands exited 0 with 23 checks passing.
- `shipping-scripted.json` records the second run's evidence and sandbox.

From `extensions/pi-pstack`, both runs used this command, with the second output sent to `family-second.log`.

```sh
TMPDIR=/Users/josh-desktop/pstack-runs/u39-followups \
PSTACK_E2E_EVIDENCE_DIR=/Users/josh-desktop/src/personal/pi-native-pstack/real/u39-evidence/followups/item2 \
node --disable-warning=ExperimentalWarning tests/workflow-parity/run-family.ts shipping --keep
```

For these probes only, `verifierScript` in `tests/workflow-parity/families/pr-shipping.ts` inserted the following worker command before its normal verifier commands. The probe file temporarily lived at the referenced fixture path. Both temporary changes were removed after recording the evidence.

```ts
worker.bash(`node ${ctx.pkg}/tests/workflow-parity/fixtures/credential-isolation-probe.mjs`);
```

The first sandbox is `/Users/josh-desktop/pstack-runs/u39-followups/pstack-parity-4a6f2e88/wf-R4ZlAW`. The second is `/Users/josh-desktop/pstack-runs/u39-followups/pstack-parity-4a6f2e88/wf-4aAZPI`. Their verifier-21 sessions and container spawn events retain the original runtime evidence.

## Limits

This probe found no operator credential leak through the checked variables, Git helper, gh login, keychain, or container mounts. It does not prove a general security boundary against a malicious worker. The literal token-absence and no-credential requirements remain false because the fixture intentionally supplies a synthetic token. The family checker passing does not establish those stronger requirements. No receive-pack authorization probe, push, merge-gate run, or timeout increase was performed.
