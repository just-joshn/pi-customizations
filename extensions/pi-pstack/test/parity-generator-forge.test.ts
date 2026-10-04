import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const playbook = (name: string) => readFile(join(root, 'skills/poteto-mode/playbooks', `${name}.md`), 'utf8');

const forgeDetection = ['opening-a-pr', 'babysit', 'shipping', 'autopilot-full', 'autopilot-stack', 'multi-phase-plan'];

test('every forge-resolving playbook detects the origin CLI at its installed path and repairs it before any gh fallback', async () => {
  for (const name of forgeDetection) {
    const text = await playbook(name);
    expect({ name, bare: /`command -v origin` succeeds/.test(text) }).toEqual({ name, bare: false });
    expect(text).toContain('`command -v origin || test -x ~/.local/bin/origin`');
    expect(text).toContain('Load the `origin` skill to repair a missing or unauthenticated CLI before any fallback to `gh`.');
  }
});

test('an the origin host repository never falls back to gh and keeps its work where the origin CLI is authenticated', async () => {
  for (const name of forgeDetection) {
    expect(await playbook(name)).toContain(
      'A repository whose remote is `the origin host` is an Origin repository. Keep its owners and verifiers local, or on an executor with the origin CLI authenticated, and never fall back to `gh` for it. Mark the lane BLOCKED instead.',
    );
  }
});

test('opening a PR preserves the source ready status and base-branch chain on Origin', async () => {
  const text = await playbook('opening-a-pr');
  expect(text).toContain('With Origin, pass `--status open`.');
  expect(text).toContain('Without a built-in PR tool, create a child with `origin pr create --status open --base <parent-branch>` or `gh pr create --base <parent-branch>` according to the resolved forge');
  expect(text).not.toContain('--stack-on');
});

test('babysit keeps complete Origin thread evidence and one watcher with a one-shot fallback heartbeat', async () => {
  const text = await playbook('babysit');
  expect(text).toContain('`origin pr thread list <pr>`, and');
  expect(text).not.toContain('--unresolved --json id,resolved,path');
  expect(text).toContain("Keep one watcher plus the loop skill's one-shot fallback heartbeat, and never a second polling loop.");
  expect(text).not.toContain('Never add a second sleep loop.');
});

test('Origin check watches run as events under BackgroundShell locally and through the CI subscription in a durable root', async () => {
  const babysit = await playbook('babysit');
  expect(babysit).toContain('Run the Origin check watch under `BackgroundShell` with an output sentinel in a local root, or through the CI subscription the host contract names in a durable root, never as a blocking foreground watch.');
  expect(await playbook('shipping')).toContain('`origin pr checks <pr> --watch` (under `BackgroundShell` with an output sentinel in a local root, or through the CI subscription the host contract names in a durable root)');
});

test('autonomous run states the exit predicate without a port-added goal lifecycle', async () => {
  const text = await playbook('autonomous-run');
  expect(text).toContain('State the exit condition as a checkable predicate before the first iteration');
  expect(text).not.toContain('CreateGoal');
});

test('program playbooks arm hourly loops without completing a goal they no longer create', async () => {
  for (const name of ['autopilot-full', 'autopilot-stack', 'multi-phase-plan']) {
    const text = await playbook(name);
    expect(text).toContain('/loop 1h');
    expect(text).not.toContain('UpdateGoal');
    expect(text).not.toContain('armed `/goal`');
  }
});

test('a cloud root arms its session-attached hourly loop on its own VM', async () => {
  const loop = await readFile(join(root, 'host/skills/loop/SKILL.md'), 'utf8');
  expect(loop).toContain('A cloud root arms the shell on its own VM.');
  expect(loop).toContain('`/loop 1h` means 3600 seconds in either environment.');
});

test('plan lanes retain surface-selected control commands and screenshot evidence without a cleanup override', async () => {
  const plan = await playbook('multi-phase-plan');
  expect(plan).toContain('**Control skill.** Pick it by surface.');
  expect(plan).toContain("<Deliver input only through the control skill's commands. Name the read-only diagnostics.>");
  expect(plan).toContain('Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.');
  expect(plan).not.toContain('This brief overrides the control skill cleanup default.');
});
