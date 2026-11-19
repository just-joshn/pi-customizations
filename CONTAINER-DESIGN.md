# CONTAINER-DESIGN: container-only isolation for pi-pstack-v2

Design only. No Seatbelt, no bwrap, no fallback, no dual backend.

Synthesized from arena base `arena-1` with grafts from `arena-2` and `arena-3`. See `.pi/arena-container-migration/SYNTHESIS.md`.

## 0. Facts measured on this machine (Apple `container` 1.7.1)

| # | Probe | Result | Design consequence |
|---|---|---|---|
| 1 | RW and `readonly` bind mounts of directories | Enforced; ro write gives `Read-only file system` | Mount policy replaces the Seatbelt profile |
| 2 | A directory ro-mounted inside an RW directory (`.git/hooks` in `/w`) | Works; writes under it fail, siblings (`.git/config`) stay writable | Nested ro overlays work for directories |
| 3 | Bind-mounting a single **file** | Fails: `path ... is not a directory` | **No file-level mounts.** Protect files by directory overlay or by sweep/restore |
| 4 | `mv` of a mounted directory | `Device or resource busy` | A mount point cannot be renamed, which matches the old `lock` for mounted directories |
| 5 | `mv /w/.git /w/.git2` where `.git` only contains a mount | Succeeded, no error | Parent lock is **not** enforced. The sweep is the backstop, as before |
| 6 | Guest `/run`, `/var/run` | Empty, and there is no host D-Bus, Docker socket or tmux socket | Unix-socket and `/run` hiding comes free. Delete the seccomp filter |
| 7 | Guest OS | Linux VM; macOS binaries do not run | Image carries every tool; host `node`, `git`, `tmux` paths are meaningless inside |
| 8 | `container run` flags | `--name`, `--cidfile`, `--rm`, `--init`, `--tmpfs`, `--read-only`, `--cap-drop`, `--network`, `--cpus`, `--memory`, `--user`, `-e`, `-w`, `--label`; experimental `--read-only-path` and `--masked-path` | Enough to build the argv. Do not depend on the experimental two |
| 9 | Host Pi install (JS tree) mounted ro into `node:22-bookworm-slim` | `pi-coding-agent/dist/cli.js` runs | Pi runs in-guest from a ro mount, with no Pi baked into the image |

Coordinator re-probe confirmed probes 3 and 5. Lowest common denominator across Apple `container`, podman, and docker is **directory** bind mounts. One policy builder serves all three.

## 1. Core types (replace `SandboxPolicy`)

`src/sandbox.ts` becomes `src/container.ts`.

```ts
export const CONTAINED_ENV = 'PSTACK_V2_CONTAINED';  // was PSTACK_V2_SANDBOXED
export const JOB_DIR_ENV = 'PSTACK_V2_JOB_DIR';       // unchanged
export const TOP_DIR_ENV = 'PSTACK_V2_TOP_DIR';       // unchanged

export interface ContainerPolicy {
  /** Directories mounted read-write at their own host path. Only directories, never files. */
  writable: string[];
  /** Directories mounted read-only on top of `writable`: git hooks/info/worktrees/modules, `.pi` code dirs, editor/harness dirs that exist at launch. */
  protect: string[];
  /** Files that cannot be mounted. Snapshotted at launch and restored on exit by the sweep. Git config, config.worktree, `.git` pointer files, `.pi/settings.json`, `.pi/mcp.json`, `*.code-workspace`, `.cursorignore`. */
  guardFiles: string[];
  /** Checkouts the job writes. Sweep inventory and quarantine roots. */
  checkouts: string[];
  /** Git common dirs. `worktrees/` and `modules/` mounted ro; job's own worktree gitdir mounted rw on top. */
  gitDirs: string[];
  /** Shared host Pi agent directory, mounted read-only so anchored settings resolve. */
  agentDir: string;
  /** Shared credentials directory (`<top>/agent/creds`), the only shared rw mount for auth.json + locks. */
  credsDir: string;
  jobDir: string;
  /** Working directory inside the container (matches host cwd). */
  cwd: string;
  /** Container name `pstack-<jobId>` for stop/kill without deriving in two places. */
  name: string;
  /** Host path for `--cidfile`. */
  cidFile: string;
  readonly: boolean;
  network: 'default' | 'none';
}

export interface ContainerRuntime {
  bin: 'container' | 'podman' | 'docker';
  image: string;
}

export interface Contained {
  argv: string[];
  name: string;
  cidfile: string;
}
```

Dropped vs today: `lock` (probes 4–5), Seatbelt regex machinery, file-mount assumptions. Old `lock` becomes "mount point cannot be renamed" where a mount exists, plus exit sweep and `guardFiles`.

`JobSpec.policy` becomes `ContainerPolicy`. `start()`, `serveRequests()`, and tests import from `container.ts` only.

## 2. `contained(argv, policy, runtime) -> Contained`

Pure function of its inputs plus one `detectRuntime()` call. Output is the argv the host `wrapper.sh` execs in place of today's `sandboxed()` output. `run()` in `jobs.ts` keeps the wrapper and drops the macOS `PATH`/`mktemp` shim.

```
container run --rm --init
  --name <policy.name>
  --cidfile <policy.cidFile>
  --label pstack.top=<hash(top)> --label pstack.job=<id>
  --cap-drop ALL
  --read-only --tmpfs /tmp --tmpfs /run
  --user <hostuid>:<hostgid>            # podman also: --userns=keep-id
  --cpus <n> --memory <m>               # defaults: half host CPUs, 8 GiB
  --network default|none
  -w <policy.cwd>
  --mount type=bind,source=<p>,target=<p>            for each writable
  --mount type=bind,source=<p>,target=<p>,readonly   for each protect (after writable)
  --mount ...,readonly  <pi install root>, <pstack package dir>, <agentDir>
  --mount type=bind,source=<credsDir>,target=<credsDir>   # rw shared auth
  -e KEY=VAL ...
  <image> <guestArgv...>
```

Rules:

- **Order.** Writable, then protect, then own-worktree gitdir rw, then pi/agent/creds. Sort mounts by target path depth so a deeper mount always follows its parent. Unit-test the ordering.
- **Directory mounts only.** Create empty placeholder dirs for protect/gitDirs targets that must exist (`hooks/`, `info/`, `worktrees/`, `modules/`). Files go in `guardFiles`, not mounts. Delete `existingRedirects()` and the regex builders.
- **No host `$HOME`.** Only listed host paths enter the guest. No `--ssh`, no `--publish-socket`, no docker socket. `HOME=<jobDir>/tmp/home` inside.
- **Network.** Default open (parity). `network: 'none'` reserved for later `tmux_run` use, not wired now.
- **Env.** Pass `CONTAINED_ENV=1`, `JOB_DIR_ENV`, `TOP_DIR_ENV`, `PI_CODING_AGENT_DIR` (private `<jobDir>/agent`), temp/cache env, and `SANDBOX_COMPAT` for Chromium/Firefox. Delete `MAC_CHROMIUM_TMPDIR`, `TMPPREFIX`, and the macOS `mktemp` shim. Guest `/tmp` is private tmpfs.
- **Cleanup.** (a) `--rm`. (b) Wrapper `finish()` runs `container stop -t 2 <name>` then `kill` on timeout, then host sweep and cache purge. Replaces `kill -KILL -- -$pid`. (c) `tmux_jobs stop` and root shutdown run `container ls -a --label pstack.top=<hash>` and stop leftovers.
- **Detect.** `detectRuntime(platform)`: darwin requires `container` on PATH and a running system, else throw with install steps. Linux/WSL2: section 5. Cache per process. Never fall back to Seatbelt or bwrap.

## 3. Image strategy

One derived image, built on demand, never pulled per job.

- **Containerfile** at `extensions/pi-pstack-v2/container/Containerfile`: `FROM node:22-bookworm-slim` plus `git`, `ripgrep`, `curl`, `ca-certificates`, `coreutils`, `procps`, `jq`, `openssh-client`, `gh`, `python3`, `build-essential`. No tmux in the guest (host tmux owns the session). No Pi, no pstack, no credentials in the image.
- **Tag:** `pstack-v2-job:<sha256 of Containerfile, 12 chars>`.
- **`ensureImage()`:** inspect, else `container build` / `docker build` / `podman build` once, streaming to the job `output.log`. First launch may take minutes; say so. Later launches pay VM boot (~1 s measured).
- **Pi in the guest:** mount the host Pi release root (from `process.argv[1]` realpath) **read-only at the same host path**. Rewrite argv to `node <root>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js …`. Guest `node` comes from the image. Fail loudly if Linux `pi-tui` prebuilds are missing.
- **pstack extension:** ro mount of the package directory so workers load the same extension. Sweep stays host-side with `process.execPath`.
- **Override:** `PSTACK_V2_IMAGE` replaces the tag; `ensureImage()` only verifies it exists.
- **Host-only toolchains** (Xcode, simulators, `open`, local displays) stay in the root session.

## 4. Nested and broker model

Workers never launch containers. No runtime socket, empty `/run`, caps dropped. Make host brokering the **only** mode on every platform. Delete `brokering()` platform branches and `process.platform === 'darwin'` special cases in `jobs.ts`.

| Step | Where | Action |
| --- | --- | --- |
| Worker `pi_spawn` / `tmux_run` | Guest | `request()` writes `job.json` under `nested/` |
| Root tick | Host | `serveRequests()` validates and clamps `ContainerPolicy` |
| Launch | Host tmux | `launchBrokered(…, contained(…), …)` |
| Results | Host | `brokered/<hash>/…`; descendants mount that tree **ro** |
| Depth | Host | Pi worker cannot spawn Pi at depth > 0 |

**Cannot widen.** Keep path containment of requested `writable` against parent grant. Add a second root check: every mount built from `granted` must sit inside the parent's mount list.

**Readonly.** `readonly: true` shrinks writable to `jobDir/{session,nested,tmp}` only. Clamp may only shrink further.

**Brokered worktrees.** Root creates `<top>/brokered/<hash>/worktree`, then mounts it rw for the nested job.

## 5. Linux (non-Apple) runtime

- **Choice:** `podman` first (rootless), then `docker` if `docker info` succeeds. Neither present: refuse with an install message.
- Same `contained()` path. Shared flags: `run --rm --name --cidfile -e -w --mount type=bind,… --tmpfs --read-only --cap-drop --cpus --memory --user --init --network --label`. Extra flag table: `podman: ['--userns=keep-id']`, `docker: ['--security-opt','no-new-privileges']`, `container: []`.
- Docker/podman can mount files on Linux. The builder still uses **directory mounts only** so macOS and Linux enforce the same policy.
- WSL2 is Linux. Native Windows unsupported.

## 6. Migration plan: one wave

One commit wave, one PR. No feature flag, no dual backend.

**Delete**

- `src/sandbox.ts` entirely (`seatbeltProfile`, `bwrapArgs`, `seccompFilter`, `seccompFile`, regex/redirect helpers, `available()` for sandbox-exec/bwrap).
- `test/linux-sandbox.test.ts`.
- `jobs.ts` macOS `mktemp` shim and `bin/`, `MAC_CHROMIUM_TMPDIR`, darwin-only brokering branches, process-group `kill -KILL -- -$pid`.
- Seatbelt/bwrap wording in docs, skills, tool descriptions.

**Add**

- `src/container.ts`: types, `detectRuntime`, `ensureImage`, `mountsForPolicy`, `contained`.
- `container/Containerfile`.
- `sweep.ts` `guardFiles` snapshot + restore.
- Private `<jobDir>/agent` with symlinks to shared agent entries and `auth.json -> <credsDir>/auth.json`.

**Rename**

`SandboxPolicy → ContainerPolicy`, `sandboxed → contained`, `SANDBOX_ENV → CONTAINED_ENV` (no dual read of the old name), `SANDBOX_NOTE → CONTAINER_NOTE`.

**Credentials**

Shared `agentDir` mounts ro. Private per-job agent dir is rw and holds symlinks. Only `credsDir` is the shared rw mount for `auth.json` and locks. **First implementation check:** confirm Pi creates the lock beside the symlink target in `creds/`. If not, point `PI_CODING_AGENT_DIR` auth layout through a directory mount that satisfies the lock path.

**Sweep with file guards**

At launch, hash and copy each `guardFiles` entry into `<out>/guard/`. On exit, after the container stops and before writing `exit`, restore changed or removed guards (quarantine the modified copy, restore the original). New `.git` / `.pi` code / editor entries still go through the existing quarantine sweep. Documented gap: a modified `.git/config` exists until exit.

**Docs one-liner** (`docs/pi-mechanisms.md` Pi rules table)

> | No permission popups. Run in a container. | Every `pi_spawn` and `tmux_run` job runs inside an isolated Linux container (Apple `container` on macOS, Podman or Docker on Linux) with a read-only root filesystem. Writes are limited to the worker's own session directory, its worktree or working directory, the repository's git directory, and private temp directories. Pi's own configuration stays read-only. No job runs uncontained. |

Rewrite "Sandbox details" → "Container details". Cover mounts, image, no-file-mount + guardFiles, and host-only toolchains in the root session.

## 7. Test changes

- **Delete** `test/linux-sandbox.test.ts`.
- **Rewrite** `test/parity.test.ts` as one container probe table. Gate on `detectRuntime()`. Rename the old Linux "cannot block at runtime" set to `containerCannotBlockAtRuntime` (new `.pi` / editor paths created during the job, swept after exit). **Re-measure each probe** on Apple `container` after migration. Both platforms now share one expectation table.
- **New** `test/container.test.ts` (no runtime required):
  - `mountsForPolicy` golden snapshots: readonly worker, full writer, brokered worktree grant.
  - Mount ordering and ro-on-rw nesting.
  - No file sources in any mount.
  - `contained()` argv snapshots for `container`, `podman`, `docker`.
  - `detectRuntime()` missing-runtime message with stubbed PATH.
- **Adjust** `jobs.test.ts`, `extension.test.ts`, `temp-env.test.ts`, `sweep.test.ts`, `credentials.test.ts` for renames, `container stop`, guard-file restore, private agent dir.
- **Machine verification:** `verify-pi-pstack-v2` with `pi_spawn`, `tmux_run`, nested spawn, readonly worker. Evidence: write outcomes and `container ls -a` empty of job names after stop.

## 8. Shapes

### Shape A (selected): one container per job, host-side wrapper

Host tmux runs `wrapper.sh`, which runs `container run … <image> <argv>` and does sweep/exit on the host. Nested jobs go through the root broker.

### Shape B (rejected): long-lived container + `exec` for descendants

Needs mount capability inside a guest the model controls. Breaks "nested jobs cannot widen grant." Rejected.

## Rationale and rejected alternatives

**Selected: Shape A.** One job → one VM. Keeps broker, wrapper, sweep. Deletes the most isolation code and adds one builder.

**Rejected**

- Shape B (shared container, exec descendants): CAP_SYS_ADMIN in the guest.
- Dual Seatbelt/bwrap fallback: forbidden.
- `--os darwin` / host Mach-O in guest: unsupported.
- Baking Pi into the image: version drift.
- File bind mounts: Apple `container` refuses them; parity would diverge.
- Passing container/Docker sockets into workers: host escape.
- Mounting `$HOME` ro: credential leak.
- Docker-first on Linux: larger blast radius than rootless podman; docker stays second choice.
- Remapped `/workspace` guest paths: breaks absolute git worktree and agent symlink paths.
- Per-job image build: wasteful.
