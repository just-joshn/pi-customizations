# Phase A predicate harness report

**Unit.** pb-4 / Phase B unit 1 (harness scaffold).

**Goal context.** Re-runnable checks for Phase A inventory predicates toward Pi-native pi-pstack parity with Cursor pstack 0.15.36. This report records one harness run. It does not claim parity acceptance.

**Lever.** `parity/scripts/check-parity-predicate.mjs`

**Makefile.** Not wired. Root Makefile has no existing `parity/scripts/check-*` pattern to extend.

## Run (2026-10-31)

Command:

```bash
node parity/scripts/check-parity-predicate.mjs
```

Stdout (exit 0):

```
parity-predicate: PASS
PASS  tip-skills-inventory: 58 tip skills present under extensions/pi-pstack/skills (source: /tmp/cursor-plugins-rea/pstack/skills)
PASS  soft-deps-present: all soft-deps present: deslop, control-cli, control-ui, create-skill, no-comments, benchmark-checklist
PASS  no-upstream-sync-machinery: absent: upstream.lock.json, scripts/sync-upstream.mjs, docs/harness
PASS  host-tools-registered: src mentions Task, TodoWrite, AskQuestion, visualize, subscribe_github_pr, subscribe_timer, subscribe_webhook, Loop; durable supervisor bin exists
PASS  create-skill-depth: SKILL.md is 17633 bytes (> 12288)
PASS  durable-artifacts: present: src/subscriptions/durable-store.ts, src/subscriptions/supervisor.ts, bin/pstack-routines-supervisor
```

## Checks covered

1. Tip skills inventory (tip clone or installed cache fallback)
2. Soft-deps present
3. No upstream-sync machinery (RES-011 paths)
4. Host tools registered in `extensions/pi-pstack/src` plus durable supervisor bin
5. create-skill depth (`SKILL.md` > 12 KiB)
6. Durable artifacts (`durable-store.ts`, `supervisor.ts`, `bin/pstack-routines-supervisor`)
