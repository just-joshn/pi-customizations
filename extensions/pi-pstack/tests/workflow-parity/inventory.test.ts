// The harness covers every engineering workflow family, and each family can fail. No Pi process runs here.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { families } from './families/index.ts';
import { validateSources } from './lib/check.ts';
import { PKG } from './lib/driver.ts';

const PLAYBOOKS = readdirSync(join(PKG, 'generated/skills/poteto-mode/playbooks')).map((file) => file.replace(/\.md$/, ''));
// Babysit, Shipping, Autopilot-full, Autopilot-stack, Orchestrate and Opening a PR belong to the PR phase.
const PR_PLAYBOOKS = ['babysit', 'shipping', 'autopilot-full', 'autopilot-stack', 'orchestrate', 'opening-a-pr'];
const ENGINEERING_SKILLS = ['how', 'why', 'teach', 'architect', 'arena', 'swarm', 'interrogate', 'verify-this', 'tdd', 'statechart', 'create-formal-verification-skill', 'create-verification-skill', 'reflect', 'recall', 'ketchup', 'show-me-your-work'];

test('every non-PR playbook and every engineering skill has a family', () => {
  const ids = new Set(families.map((family) => family.id));
  const wanted = [...PLAYBOOKS.filter((name) => !PR_PLAYBOOKS.includes(name)), ...ENGINEERING_SKILLS];
  expect(wanted.filter((name) => !ids.has(name))).toEqual([]);
  expect(new Set(families.map((family) => family.id)).size).toBe(families.length);
});

test.for(families.map((family) => family.id))('%s: sources resolve, ids are unique, and every negative targets a real check', (id) => {
  const family = families.find((entry) => entry.id === id);
  expect(family).toBeDefined();
  if (family === undefined) return;
  validateSources(family.checks);
  const ids = family.checks.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(family.negatives.length).toBeGreaterThan(0);
  for (const negative of family.negatives) {
    expect(negative.fails.length + (negative.passes ?? []).length, `${family.id}: ${negative.name} names no check`).toBeGreaterThan(0);
    expect([...negative.fails, ...(negative.passes ?? [])].filter((checkId) => !ids.includes(checkId)), `${family.id}: ${negative.name}`).toEqual([]);
  }
  for (const defect of family.knownDefects ?? []) expect(ids).toContain(defect.checkId);
});
