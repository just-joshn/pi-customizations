# Linux native target receipt — IN PROGRESS

- Exact source under test: `544e2deb2cf4c404a8be1c3dc5afc2b79b21bc90` (verified before any work).
- Target: Debian GNU/Linux 12, glibc 2.36, Linux aarch64/Node arm64. This is **not** an x64 runner.
- Scope: native package typecheck/tests and a clean npm tarball installation into stable Pi 1.5.0, using the existing scripted-model fixture only. No feature implementation, publication, merge, live provider call, real Slack/automation operation, or whole-plugin parity claim.
- Installed host-skill path was absent; repository `AGENTS.md` and the explicitly scoped verification request govern this run.
- Baseline Node v24.22.2 and npm 11.19.1 are present; Bun, Pi, bubblewrap, socat, and ripgrep are absent initially. See `00-baseline.log` for the unedited manifests, workflow, source SHA, OS, and initial toolchain.
- Declared prerequisites: package/root Node >=22.19.0; CI Node 26.13.0 and Bun 1.4.2; Linux CI bubblewrap, socat, ripgrep; frozen Bun workspace dependencies; clean consumer stable `@earendil-works/pi-coding-agent@1.5.0` and the packed package's declared dependencies/peers. CI additionally runs the separate statechart script with Java 25.0.5+8 and checksum-verified TLC 1.7.4.
- Method: `run-command.sh` records the exact command, cwd, UTC bounds, raw output, and real exit code for each stage. Final results, failures, skips, target limitations, and artifact hashes will be appended after execution.
