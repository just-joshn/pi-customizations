import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { mergeBennySettings } from '../../src/automation/settings.ts';
import { createAutomation, type AutomationDeps } from '../../adapters/automation-events.ts';
import type { WorkerResult } from '../../src/automation/model.ts';
import type { ThreadMessage } from '../../src/automation/outbox.ts';
import * as configuration from '../../src/automation/configuration.ts';

const roots: string[] = [];
const project = () => {
  const p = mkdtempSync(join(tmpdir(), 'benny-parity-'));
  roots.push(p);
  return p;
};
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const event = { source_channel_id: 'CTEST', ts: '1700000000.000001', text: 'Broken' };
const result: WorkerResult = { text: 'Broken.\n[benny:bug]', tracker: { operation: 'create', title: 'Broken', body: 'Expected working, observed broken' } };
function fixture(messages: ThreadMessage[] = [], kind: 'triage' | 'reproduce' = 'triage') {
  const p = project();
  const tickets: string[] = [];
  let spawns = 0;
  let crash = true;
  const deps: AutomationDeps = {
    spawnWorker: async () => {
      spawns++;
    },
    inputCommit: () => 'a'.repeat(40),
    prerequisites: { tracker: async () => true, controlAdapter: async () => true, featureMap: async () => true },
    destination: { readThread: async () => messages, post: async () => ({ ts: '2.000001' }) },
    tracker: {
      searchByMarker: async (marker: string) => (tickets.includes(marker) ? [{ id: 'ticket' }] : []),
      create: async (action: { id: string }) => {
        tickets.push(action.id);
        if (crash) {
          crash = false;
          throw new Error('crash');
        }
        return { id: 'ticket' };
      },
      update: async () => ({ id: 'ticket' }),
      comment: async () => ({ id: 'ticket' }),
    },
    trackerPolicy: async () => ({ classification: 'bug', clearlyBroken: true, live: true, duplicate: 'none', sourceVerified: true, targetResolved: true, canCompensate: true }),
  };
  const config = { name: 'benny', projectRoot: p, sourceChannelId: 'CTEST', kind, triageIdentityUserId: 'UTRUSTED' };
  return { config, deps, tickets, spawns: () => spawns, automation: createAutomation(config, deps) };
}
test('tracker crash recovery and redelivery creates one ticket', async () => {
  const f = fixture();
  const run = await f.automation.handle(event);
  if (run.status !== 'dispatched') throw Error('not dispatched');
  await expect(f.automation.complete(run.runId, result)).rejects.toThrow('crash');
  const restarted = createAutomation(f.config, f.deps);
  await restarted.reconcile();
  await restarted.complete(run.runId, result);
  expect(f.tickets).toHaveLength(1);
});
test('parent rejects ineligible tracker actions', async () => {
  const f = fixture();
  f.deps.trackerPolicy = async () => ({ classification: 'other', clearlyBroken: false, live: true, duplicate: 'none', sourceVerified: true, targetResolved: true, canCompensate: true });
  const a = createAutomation(f.config, f.deps);
  const run = await a.handle(event);
  if (run.status !== 'dispatched') throw Error('not dispatched');
  expect(await a.complete(run.runId, result)).toMatchObject({ status: 'refused' });
  expect(f.tickets).toHaveLength(0);
});
test.for([
  [],
  [{ ts: '2.000001', user: 'UWRONG', text: '[benny:bug]' }],
  [
    { ts: '2.000001', user: 'UTRUSTED', text: '[benny:bug]' },
    { ts: '3.000001', user: 'UTRUSTED', text: '[benny:other]' },
  ],
])('reproduce fails closed for untrusted or ambiguous handoff %j', async (messages) => {
  const f = fixture(messages, 'reproduce');
  expect(await f.automation.handle(event)).toMatchObject({ status: 'rejected' });
  expect(f.spawns()).toBe(0);
});
test('loader accepts the real template and rejects malformed input', () => {
  const p = project();
  const path = join(p, 'configuration.yaml');
  writeFileSync(path, readFileSync(resolve('automations/benny/templates/configuration.example.yaml')));
  expect(configuration.loadBennyConfig(p, 'triage', path)).toMatchObject({ name: 'benny-triage', kind: 'triage', sourceChannelId: 'SOURCE_CHANNEL_ID' });
  writeFileSync(path, 'schema_version: 1\nslack: []');
  expect(() => configuration.loadBennyConfig(p, 'triage', path)).toThrow();
});
test('setup creates a private secret once without printing it and preserves settings conflicts', () => {
  const p = project();
  const file = join(p, 'secret.json');
  const run = () => execFileSync(process.execPath, [resolve('scripts/benny-setup.mjs'), '--project', p, '--credentials', file], { encoding: 'utf8' });
  const first = run();
  const secret = readFileSync(file, 'utf8');
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(first).not.toContain(JSON.parse(secret).key);
  const settings = join(p, '.pi/settings.json');
  writeFileSync(settings, '{ // retain\n "theme": "mine", "packages": false\n}');
  const second = JSON.parse(run());
  expect(readFileSync(file, 'utf8')).toBe(secret);
  expect(readFileSync(settings, 'utf8')).toContain('"packages": false');
  expect(second.settings.conflicts).toContain('packages');
});

test('settings append preserves JSONC comments, unrelated keys, and existing packages', () => {
  const path = join(project(), 'settings.json');
  writeFileSync(path, '{ // keep comment\n "theme": ",}", "packages": ["npm:other", /* keep this too */], }');
  expect(mergeBennySettings(path)).toEqual({ added: ['packages'], conflicts: [] });
  const saved = readFileSync(path, 'utf8');
  expect(saved).toContain('// keep comment');
  expect(saved).toContain('/* keep this too */');
  expect(saved).toContain('"theme": ",}"');
  expect(saved).toContain('"npm:other"');
  expect(mergeBennySettings(path)).toEqual({ added: [], conflicts: [] });
  expect(readFileSync(path, 'utf8')).toBe(saved);
});
test('trusted bug verdict dispatches reproduce once', async () => {
  const f = fixture([{ ts: '2.000001', user: 'UTRUSTED', text: '[benny:bug]' }], 'reproduce');
  expect(await f.automation.handle(event)).toMatchObject({ status: 'dispatched' });
  expect(await f.automation.handle(event)).toMatchObject({ status: 'duplicate' });
  expect(f.spawns()).toBe(1);
});
