# Migrating the repository from npm to Bun

## What this is for

Two people notice this work. A colleague cloning the repository runs one `bun install` at the root instead of five `npm ci` calls, and `make verify` stays the only command they need. A colleague who consumes an extension through `pi install` sees nothing change, because the published packages keep the same contents. The next engineer to own the toolchain inherits one lockfile, one install, and a gate that fails when npm comes back.

## Definition of done

A falsifiable predicate, measured on the real tree rather than on a summary.

1. `make verify` exits 0 with `bun` as the only package manager on the path.
2. The gate matrix matches the captured npm baseline row for row, with one deliberate exception named in item 3.
3. `pi-antigravity-oauth` stops importing an undeclared dependency. Its vendoring script reads `@google/genai` from a hoisted transitive install today, which is the one gate the migration breaks.
4. No `package-lock.json` remains in the tree, and `bun ci` installs a fresh export from the committed `bun.lock` without resolving anything new.
5. No maintained file invokes `npm`, `npx`, `npm ci`, or `--prefix`, apart from historical decision rows and the immutable upstream snapshot.
6. A new gate fails when someone reintroduces npm or a second lockfile. A passing result alone does not prove the gate can fail, so it carries a negative control.

## Scope

| Unit | Count | Note |
| --- | --- | --- |
| `package.json` files | 6 | root plus five extensions |
| `Makefile` npm invocations | 16 | becomes `bun run --filter` |
| lockfiles | 5 deleted, 1 added | five `package-lock.json` become one root `bun.lock` |
| gate scripts needing a dependency fix | 1 | `vendor-pi-ai.mjs` |
| `npm pack` call sites | 1 | `pi-pstack/test/cli.test.ts` |
| error strings naming `npm run` | 2 | `resources.mjs`, `src/index.ts` |
| maintained docs naming npm | ~20 | READMEs and `docs/*.md` |
| skill docs with generic npm examples | 3 | each decided on its own |
| files mentioning npm | 44 | 14 are historical audit trails, left alone |

Effort sits in verification rather than editing. The edits are mechanical once the topology is fixed.

## Rigor

High. Five published packages and the entire toolchain move at once, and the gates are the only safety net. Every change is reversible through git, so no irreversible-write gate applies.

## The topology fork, measured

Three layouts were probed by exporting the tracked tree to `/tmp` and installing there. `probe-topology.sh` beside this file reruns the probe without touching the checkout, and its outputs are `topology-probe-default.log` and `topology-probe-hoisted.log`.

| | five installs, no workspace | root workspace, hoisted | root workspace, isolated |
| --- | --- | --- | --- |
| lockfiles | 6 | 1 | 1 |
| installs | 6 | 1 | 1 |
| `--filter` for gates | no | yes | yes |
| `extensions/pi-pstack/node_modules/@earendil-works/pi-coding-agent` | present | absent | present |
| `extensions/pi-tui-parity/node_modules` | present | present | present |
| `extensions/pi-antigravity-oauth/node_modules/@google/genai` | present | absent | absent |
| gate scripts broken | 0 | 3 | 1 |
| five typechecks | n/a | pass | pass |

The explicit-hoisted run moved every package to the root `node_modules` and left `extensions/pi-pstack/node_modules/.bin/vitest` absent. Three scripts read a package-local Pi install by path, so hoisted linking breaks `scripts/check-pi-mechanisms.mjs`, `scripts/verify-fresh-install.mjs`, and `vendor-pi-ai.mjs`.

The isolated run kept a per-package `node_modules` of symlinks. It is also what Bun 1.4.2 picks by itself for a workspace with a new lockfile, recorded as `configVersion: 1`. Only the undeclared `@google/genai` breaks, and that is a real bug rather than a layout problem.

Full gate measurement on the isolated probe, with the tree exported to `/tmp/bun-probe-isolated`:

| suite | npm baseline | Bun isolated |
| --- | --- | --- |
| `pi-pstack` tests | 219 | 219 |
| `pi-pstack` statements / branches | 86.51 / 81.78 | 86.92 / 83.82 |
| `pi-tui-parity` tests | 112 | 112 |
| `pi-tui-parity` statements / branches | 89.84 / 89.74 | 89.84 / 89.74 |
| `pi-one-dark-pro-theme` tests | 82 | 82 |
| `pi-one-dark-pro-theme` statements / branches | 97.25 / 89.84 | 97.25 / 89.84 |
| `pi-anthropic-oauth` tests | 6 | 6 |
| `pi-antigravity-oauth` tests | 38 | 38 |
| `check-pi-mechanisms.mjs` | 6 packages, 0 violations | 6 packages, 0 violations |
| `check-vitest-conventions.mjs` | 43 files, 0 violations | 43 files, 0 violations |
| `pi-antigravity-oauth check:vendor` | pass | **fails on the undeclared dependency** |

## What stays as it is

Historical audit rows under `.audit/**` record what happened at a point in time. Rewriting them to say `bun` would falsify the record. The same applies to `extensions/pi-pstack/upstream/**` and `extensions/pi-pstack/upstream-team-kit/**`, which are hash-checked snapshots.

Node stays installed and stays the runtime. Pi is a Node program, the gate scripts spawn it through `process.execPath`, and `bun run` deliberately uses the system `node` for any script that names it. Replacing the runtime is a separate change with its own risk and it is not what "migrate from npm" asks for.

## Open decisions

- Topology. The recommendation is the root workspace with the isolated linker, because Bun picks that layout on its own and it needs one real fix rather than three.
- `catalog:` for the versions five packages pin in common (`@earendil-works/pi-*` 0.87.1, `vitest`, `typescript`). Bun documents catalogs for exactly this case. Not requested, so the default is to leave dependency declarations alone.
- `engines` in each `package.json`. Bun ignores `engines` outright and `engine-strict` does nothing. Keeping the field documents the runtime Pi actually needs. The recommendation is to keep it.
- `no-comments` routes to a `Comment Sicko` subagent type that this host does not register. The substitution is the bundled `thermo-nuclear-code-quality-review` persona, reported as a substitution rather than as compliance.

## Verification artifacts

- `baseline-make-verify.log` is the npm baseline, exit 0, captured before any edit.
- `bun-best-practices.md` is the cited digest of the installed Bun 1.4.2 binary and the current official docs.
- A gate matrix extractor normalizes a `make verify` log into one fact per line so the two runs can be diffed rather than read.
