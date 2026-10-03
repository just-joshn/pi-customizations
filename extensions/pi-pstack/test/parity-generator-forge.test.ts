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

test('opening a PR pushes the branch first, and creates stack children with --stack-on on Origin', async () => {
  const text = await playbook('opening-a-pr');
  expect(text).toContain('With Origin, push the branch first or pass `--push`, and pass `--status open`.');
  expect(text).toContain('Without a built-in PR tool, create a child with `origin pr create --status open --stack-on <parent-pr>` or `gh pr create --base <parent-branch>` according to the resolved forge');
});

test('babysit lists only unresolved Origin threads and holds one watcher with a one-shot fallback heartbeat', async () => {
  const text = await playbook('babysit');
  expect(text).toContain('`origin pr thread list <pr> --unresolved --json id,resolved,path`');
  expect(text).toContain("Keep one watcher plus the loop skill's one-shot fallback heartbeat, and never a second polling loop.");
  expect(text).not.toContain('Never add a second sleep loop.');
});

test('Origin check watches run as events under BackgroundShell locally and through the CI subscription in a durable root', async () => {
  const babysit = await playbook('babysit');
  expect(babysit).toContain('Run the Origin check watch under `BackgroundShell` with an output sentinel in a local root, or through the CI subscription the host contract names in a durable root, never as a blocking foreground watch.');
  expect(await playbook('shipping')).toContain('`origin pr checks <pr> --watch` (under `BackgroundShell` with an output sentinel in a local root, or through the CI subscription the host contract names in a durable root)');
});

test('autonomous run arms a goal with the exit predicate and uses the loop only as the wake', async () => {
  expect(await playbook('autonomous-run')).toContain('Arm a `/goal` with `CreateGoal` carrying that predicate, so the goal outlives a single turn, and use `/loop` only as the wake mechanism.');
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

test('plan lanes prefer a committed verify skill, name their input commands, and keep their screenshots', async () => {
  const plan = await playbook('multi-phase-plan');
  expect(plan).toContain("Prefer the repository's committed `verify-<app>` skill when it exists. Otherwise pick it by surface.");
  expect(plan).toContain(
    '<Deliver input only through the commands of the generated `verify-<app>` skill from `create-verification-skill` when the repository has one, otherwise through the harness commands this lane writes down before driving. Name the read-only diagnostics.>',
  );
  expect(plan).toContain('Keep these files. This brief overrides the control skill cleanup default.');
});
