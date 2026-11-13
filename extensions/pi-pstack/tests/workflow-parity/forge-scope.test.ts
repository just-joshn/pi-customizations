import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { verifierScript } from './families/pr-shipping.ts';
import { Parent } from './fixtures/dsl.ts';
import { type Ctx, PKG } from './lib/driver.ts';

test('only a fake-forge scenario asks its scripted verifier to run credential isolation', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'forge-scope-'));
  const ctx: Ctx = {
    driver: 'scripted',
    sandbox,
    repo: join(sandbox, 'repo'),
    pkg: PKG,
    base: 'base',
    commits: ['base'],
    runId: 'run',
    agentDir: join(sandbox, 'agent'),
    sessionsDir: join(sandbox, 'sessions'),
    skill: (name) => join(PKG, 'generated/skills', name, 'SKILL.md'),
    playbook: (name) => join(PKG, 'generated/skills/poteto-mode/playbooks', `${name}.md`),
  };
  const steps = () => verifierScript(ctx, new Parent(ctx), { id: 'verifier', pr: 21, head: 'head', testFile: 'test.js' }).steps;
  try {
    expect(JSON.stringify(steps())).not.toContain('credential-isolation.mjs');
    mkdirSync(join(sandbox, 'forge'));
    expect(JSON.stringify(steps())).toContain('credential-isolation.mjs');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
