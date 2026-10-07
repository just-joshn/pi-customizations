# User-perspective verification program: framing and design

Run date: 2026-10-07. Repo: `/Users/josh-desktop/src/personal/user-perspective-testing-extensions` at `78dd5a0`, branch `test/user-perspective-testing-extensions`.

Playbook: the `figure-it-out` skill, because the work is large and cross-cutting, no bundled playbook fits, and the deliverable is a body of evidence rather than one change. Not `orchestrate`, because there is no PR stack to manage and no shared trunk to guard: the output is coverage receipts plus focused fix commits, and orchestrate's frontier, stacker and ledger machinery would be dead weight here (`principle-laziness-protocol`).

## Phase A: Frame

### Done predicate

Every surface in `surfaces.tsv` carries a verdict row in `verdicts.tsv` produced by the driver, and every defect found is either fixed with a real-artifact receipt or parked in `open-findings.md` with a reproduction. The predicate is computed by `scripts/coverage-report.mjs`, never narrated.

### Scope, quantified

432 user-triggerable surfaces, enumerated from source in `surface-matrix.md`, across 9 packages.

| Package | Surfaces |
| --- | --- |
| extensions/pi-pstack | 306 |
| extensions/pi-caveman | 62 |
| extensions/pi-tui-skin | 25 |
| extensions/pi-anthropic-oauth | 10 |
| extensions/pi-s50 | 9 |
| extensions/pi-antigravity-oauth | 6 |
| extensions/pi-xai-oauth | 6 |
| skills/ (5 root skills) | 6 |
| extensions/pi-one-dark-pro-theme | 2 |

The distribution is lopsided. pi-pstack is 71 percent of the surface area and holds nearly all of the deep flows (timers, routines, cloud placement, subagents, MCP, TUI widgets).

### Rigor level

High, in gates and artifacts rather than in effort words.

- Every verdict comes from a machine-written receipt, not from a worker's summary.
- The driver owns the assertions. A scenario that cannot assert is deleted, not softened.
- A surface never gets a pass from a neighbouring surface's drive.
- Fixes carry a test that fails before and passes after, plus a receipt from the real artifact.
- Inconclusive is a valid verdict and is reported as such.

### Blockers found during grounding

1. **`make verify` is red on a clean checkout.** It exits 2 at `pi-pstack typecheck`. The committed `bun.lock` pins both `@earendil-works/pi-ai@1.0.2` and `1.0.4`, because `pi-caveman` wants 1.0.4 while the other packages want 1.0.2. Two copies of the same private-declaration class land in one TypeScript program. Nothing downstream can be measured against a green baseline until this is fixed.
2. **No local remote-executor is configured.** Cloud workers are unavailable, so every unit runs on this machine. One-way consequence: concurrency is bounded by this laptop, and the TUI and OAuth drives must be serialized.
3. **The shipped harness cannot reach most of the surface.** `.pi/skills/verify-pi-customizations/bin/control-pi` is a hard-coded `if/else` over four feature names. It cannot drive the TUI, answer a dialog, restart a session, log in, or fail a provider call.
4. **The verification skill's own documentation has drifted.** `SKILL.md` says "65 skills, 64 prompt templates" while source and the drive assert 71 and 69.

## Phase B: Design

### Data shapes first

Two tables carry the whole program.

`surfaces.tsv` is the unit list. One row per surface, derived from the recon matrix, with a tier assignment and a one-line veto rule (what observation falsifies it). Written by a generator script so it can be regenerated when source moves.

`verdicts.tsv` is append-only evidence. One row per (surface_id, head_sha, receipt_path) with `verdict` in `verified | failed | inconclusive | env-limited | not-drivable`, plus the observed value. A verdict is keyed to the surface and the commit, so a fix invalidates the earlier row.

The coverage report joins them. A surface with no row is `uncovered`, which is the only state the predicate rejects.

### Metrics and tiers

Unit assignment is by observation cost, not by package.

| Tier | What it covers | How it is observed |
| --- | --- | --- |
| T0 scaffold | green baseline, driver, tables, report | the repo's own gates |
| T1 discovery | registration of every command, tool, provider, model, skill, prompt template, theme, agent, config file, env var | one Pi RPC enumeration per package, asserted against the manifest |
| T2 behaviour | each surface actually triggered, happy path plus its error and boundary inputs | declarative RPC scenarios through the driver |
| T3 deep flow | TUI rendering, restart and branch persistence, dialogs, OAuth login and refresh, provider failure and cancellation, timers, routines, subagents, cloud placement | the TUI driver and long-form RPC scripts |

T1 collapses several hundred registration rows into a small number of enumeration receipts. That is deliberate: an enumeration receipt is still a real observation of the real artifact, and it is the cheap, faithful way to cover "this exists and is named this" without pretending a drive per row.

### Sequence, riskiest unknown first

1. **T0-1 green baseline.** Decide the Pi version direction by experiment, then converge every package on one version. Verify with `make verify`.
2. **T0-2 the driver.** Add a generic scenario verb to `control-pi` and a TUI verb reusing the repo's existing tmux pattern. Pilot it by reproducing the four shipped drives as declarative scenarios, so the new path is proven equivalent before any new surface depends on it.
3. **T0-3 the tables and the report.** Generate `surfaces.tsv`, define the receipt format, write `coverage-report.mjs`.
4. **T3-1 TUI pilot.** The unknown with the highest blast radius is whether the TUI can be driven reliably at all. Settle it on one surface before building anything on it.
5. **T1 then T2, package by package**, ordered by surface count descending so the largest body of risk is exercised while the run has the most budget.
6. **T3 deep flows**, each as its own unit with its own driver capability.

### Fan-out seams

Work splits cleanly by package for T1 and T2, because each package's scenarios are independent and each writes only its own scenario file and receipt directory. One writer per file, per `principle-separate-before-serializing-shared-state`. The driver, the tables and the report are fences: workers read them, never write them.

T3 flows do not split by package. Each needs a new driver capability, so they serialize behind the driver owner. Running them in parallel would put several writers on one file.

Concurrency is capped by the machine, not by the design. Each drive starts one or more real Pi processes, and T3 drives start tmux plus Pi. In-flight cap is four for T1 and T2 and one for T3.

### Verification

The driver asserts and emits the receipt, so a worker cannot hand-write a pass. The coordinator spot-checks receipts against the raw captures. A fix unit additionally carries a test that fails before it, run against the pre-fix commit.

Recurring corrections get encoded as new veto rules or as a lint in the checker script, per `principle-encode-lessons-in-structure`.

### Scaffold before feature

T0 lands before any surface work, per `principle-foundational-thinking`. The baseline first, then the driver, then the tables, then the TUI pilot, then the surface sweep.

## Open decisions

- **Pi version direction.** 1.0.2 or 1.0.4. Settled by experiment, not by preference: whichever converges the tree with the least churn and stays green.
- **Where the driver lives.** `.pi/skills/verify-pi-customizations/`, extending the existing skill, rather than a new harness.
