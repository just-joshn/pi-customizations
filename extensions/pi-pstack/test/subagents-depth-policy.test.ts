import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { SessionDepthPolicy } from '../src/subagents/depth-policy.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G1-12] configured depth fallback is captured once per SDK session', async () => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi'), { recursive: true });
    const file = join(fixture.dir, '.pi/settings.json');
    await writeFile(file, JSON.stringify({ pstack: { maxSubagentSpawnDepth: 5 } }));
    const policy = new SessionDepthPolicy();
    const context = { cwd: fixture.dir, sessionId: fixture.session.sessionManager.getSessionId(), env: {} };
    expect(policy.cap(context)).toBe(5);
    await writeFile(file, JSON.stringify({ pstack: { maxSubagentSpawnDepth: 1 } }));
    expect(policy.cap(context)).toBe(5);
    expect(policy.cap({ ...context, env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' } })).toBe(2);
    fixture.session.sessionManager.newSession();
    expect(policy.cap({ ...context, sessionId: fixture.session.sessionManager.getSessionId() })).toBe(1);
  } finally {
    await fixture.close();
  }
});

test('[G1-12] an environment override does not prematurely capture the configured fallback', async () => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi'), { recursive: true });
    const file = join(fixture.dir, '.pi/settings.json');
    await writeFile(file, JSON.stringify({ pstack: { maxSubagentSpawnDepth: 5 } }));
    const policy = new SessionDepthPolicy();
    const context = { cwd: fixture.dir, sessionId: fixture.session.sessionManager.getSessionId(), env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' } };
    expect(policy.cap(context)).toBe(2);
    await writeFile(file, JSON.stringify({ pstack: { maxSubagentSpawnDepth: 1 } }));
    expect(policy.cap({ ...context, env: {} })).toBe(1);
  } finally {
    await fixture.close();
  }
});

test.for([0, -1, 1.5, '2', null])('[G1-12] invalid configured fallback %s uses three', async (value) => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/settings.json'), JSON.stringify({ pstack: { maxSubagentSpawnDepth: value } }));
    expect(new SessionDepthPolicy().cap({ cwd: fixture.dir, sessionId: fixture.session.sessionManager.getSessionId(), env: {} })).toBe(3);
  } finally {
    await fixture.close();
  }
});

test('[G1-12] missing configured fallback remains captured until the next session', async () => {
  const fixture = await workerFixture();
  try {
    const policy = new SessionDepthPolicy();
    const context = { cwd: fixture.dir, sessionId: fixture.session.sessionManager.getSessionId(), env: {} };
    expect(policy.cap(context)).toBe(3);
    await mkdir(join(fixture.dir, '.pi'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/settings.json'), JSON.stringify({ pstack: { maxSubagentSpawnDepth: 2 } }));
    expect(policy.cap(context)).toBe(3);
    fixture.session.sessionManager.newSession();
    expect(policy.cap({ ...context, sessionId: fixture.session.sessionManager.getSessionId() })).toBe(2);
  } finally {
    await fixture.close();
  }
});

test('[G1-12] configured fallback reaches shared startup after real child restoration', async () => {
  vi.stubEnv('CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH', '');
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', '');
  const fixture = await workerFixture();
  try {
    const launched = await fixture.call('Task', { prompt: 'first task', subagent_type: 'generalPurpose', run_in_background: false });
    const details = launched.details;
    if (typeof details !== 'object' || details === null || !('sessionFile' in details) || typeof details.sessionFile !== 'string') throw new Error('Expected a child transcript path');
    await mkdir(join(fixture.dir, '.pi'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/settings.json'), JSON.stringify({ pstack: { maxSubagentSpawnDepth: 1 } }));
    fixture.session.sessionManager.setSessionFile(details.sessionFile);
    await fixture.session.reload();
    await fixture.session.bindExtensions({ mode: 'print' });
    await expect(fixture.call('Task', { prompt: 'must not start', subagent_type: 'generalPurpose' })).rejects.toMatchObject({ code: 'subagent_depth_cap' });
  } finally {
    await fixture.close();
  }
});
