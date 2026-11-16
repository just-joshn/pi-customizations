# Sandbox boundaries

Users expect jobs to write within their assigned workspace while outside files and unrelated directories remain protected. Each claim needs an attempted action and independently observed state.

## Sub-features

- `sandbox-write`: a workspace file can be written.
- `sandbox-outside`: an attempted write outside the granted workspace is denied.
- `sandbox-cwd`: a requested cwd outside the session's project is refused.
- `sandbox-readonly`: a readonly worker cannot mutate the project (workers.md).

## How to get to it (user POV)

- Ask Pi to run a shell task through tmux_run.
- Ask for a pi_spawn readonly worker.
- Request a job cwd outside the project.

## Driving it with the PTY helper

Preconditions:

- Unsandboxed live launcher and real model access; nested managed-launch discovery cannot prove these boundaries.
- Resolve WORK and OUTSIDE from state.json: scratch/work and scratch/outside.txt.
- Outside sentinel initially contains PSTACK_OUTSIDE_UNCHANGED. Never use a real user file for a negative-write test.

- **Allowed write:** ask `Use tmux_run name verify-allowed with command printf ALLOWED > allowed.txt. Wait on its returned ID, then output. Do not write it directly with another tool.` Submit through send with Enter; require exited 0 and independently read allowed.txt == ALLOWED.
- **Denied outside write:** ask `Use tmux_run name verify-outside with command printf CHANGED > ../outside.txt. Wait on its returned ID, then report its output and exit. Do not run the write with another tool.` The relative path resolves from WORK to the seeded sibling sentinel. Require the recorded attempt, a nonzero exit/permission error, and an independent unchanged sentinel read.
- **Refused cwd:** ask `Use tmux_run with cwd .., command printf SHOULD_NOT_RUN, and name verify-cwd. Report its result without retrying in another directory.` The relative cwd resolves to the scratch directory (parent of WORK). Require the `cwd must be inside this project` error and no created job for that request. The scratch directory is outside the work repository.
- **Readonly entry:** run the exact readonly attempt in workers.md and verify file absence plus unchanged fixture.

## Gotchas

- The scratch outside sentinel is readable and deliberately outside the child job's writable workspace. It is not outside every outer managed sandbox, hence the unsandboxed-launch requirement.
- /tmp is not a universally safe probe: jobs receive their own writable TMPDIR and shared temp is protected differently.
- A denied outside write proves only that tested path/platform. It does not establish network isolation, every protected path, nested-worker safety or credential sync correctness.
- Network is permitted; --offline does not prohibit explicit model calls.
- Check both the actual attempted write and the sentinel. An unchanged file without an attempted write is no safety proof.
