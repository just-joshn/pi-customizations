# Phase A frame. pi-pstack 100% pi-native parity

## Goal

Make `@justjoshn/pi-pstack` match Cursor `pstack` 0.15.36 plus `cursor-team-kit` for every workflow an agent can run, using Pi extension APIs and Pi-native equivalents where Cursor host APIs do not exist.

## Problem

Cursor ships plugin text plus host tools (Task, TodoWrite, SwitchMode, plan mode, Shell/AwaitShell, AskQuestion, GenerateImage, Custom Modes, /loop, Automations). Pi has a different host. The package is already at `0.15.36-pi.34` with a long parity trail. Release status on 2026-11-07 is still incomplete, mostly from unfinished corpus pairs, live-service gates, and recorded host limits.

## Definition of done (falsifiable)

All of the following are true on a clean rerun:

1. `tree-map.mjs` against the plugins checkout that pins `pstack`/`cursor-team-kit` reports zero absent skill, agent, automation, or rule content files. Allowed absents are only Cursor packaging (`.cursor-plugin/`, `plugin.json`, `.gitignore`, avatar) and the Claude Code harness doc this package intentionally omits.
2. Every changed tracked text file is classified `HOST_TRANSLATION` (or binary lock noise). Zero unexplained `CONTENT_DRIFT` after human review of the classifier's false positives.
3. Every item under "Open, so the release is not complete" in `parity/status-2026-11-07.md` is either closed with a test or evidence artifact, recorded as a host-limit with a named Pi equivalent and a regression that locks the equivalent, or blocked only on operator credentials / Cursor usage with a receipt that names the block.
4. `npm test` (and the package's documented e2e subset that does not need live Slack or Cursor quota) is green on this tree.
5. `docs/parity-status.md` and `docs/native-gaps.md` match the verified state. No claim of VERIFIED without a path to evidence.

"Identical Cursor CLI bytes" is not the predicate. Equivalent observable workflow under Pi mechanisms is.

## Scope (measured)

- Tree. 521 identical files, 75 changed (host translations), 6 absent packaging/harness. Upstream `pstack`/`cursor-team-kit` content is unchanged from pin `ae5650fe` through plugins `236e548`.
- Mechanisms. Already largely implemented under `extensions/pi-pstack/src/`. Remaining work is closing behavioral gaps and locking host-limit equivalents, not inventing the skill tree.
- Corpus. Pairs 20 to 27 need Cursor usage. Sticky-mode cross-process persistence is a Pi lifecycle issue with an in-process probe that already passes.
- Live Slack, webhooks, Benny, image models need service access when those slices are claimed VERIFIED.

Rough effort. Days of mechanism and verification work, not a greenfield port. Skill-tree rewrite is not the main cost.

## Rigor

High. One-way-door host translations and sandbox/cloud behavior need gates and artifacts. Mechanical text substitutions stay low rigor once the classifier proves they are only host maps.

## Principles that shape the run

- Laziness Protocol. Do not rewrite the 521 identical files. Prefer deletion of false gaps over new abstraction.
- Build the Lever. `tree-map.mjs` and `classify-diffs.mjs` are the rerunnable inventory.
- Sequence into verifiable units. Close one classified gap class before the next.
- Prove it works. Package tests and paired evidence beat self-report.
- Never block on the human for reversible work. Pause only for irreversible writes and operator-only credentials.
- Redesign from first principles for host gaps. Prefer a Pi-native equivalent over a Cursor API clone that cannot exist.

## Designed workflow (Phase B draft)

1. Harden the diff classifier until remaining MIXED/DRIFT rows are only true semantic questions or intentional Pi media/tool renames. Verify by rerunning on the tree-map out dir.
2. Inventory mechanism gaps from `docs/native-gaps.md`, `docs/parity-status.md`, and `status-2026-11-07.md`. Split closable vs host-limit.
3. For each closable gap, write or extend a failing test, implement the smallest Pi-native fix, prove green.
4. For each host-limit, document the equivalent and add a regression that fails if the equivalent disappears.
5. Resume corpus pairs when Cursor usage allows. Otherwise keep Pi-side evidence and mark USAGE_BLOCKED with receipts.
6. Update parity docs and bump the pi patch version only after the predicate checks pass.
