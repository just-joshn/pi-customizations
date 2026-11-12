import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeParent, makeProject, makeRun, type Parent, type Project } from './harness.ts';

let project: Project;
let parent: Parent;
let runRoot: string;

beforeEach(() => {
  project = makeProject();
  runRoot = makeRun(project, 'run1');
  parent = makeParent(project, []);
});

afterEach(() => project.dispose());

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function receipt(id: string, fields: Record<string, unknown> = {}): string {
  const dir = join(runRoot, 'workers', 'w1', 'evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'test.log'), 'all green\n');
  const path = join(dir, `${id}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      id,
      runId: 'run1',
      target: 'step-3',
      kind: 'test',
      verdict: 'pass',
      commit: project.commit,
      environment: 'node 24',
      command: ['npx', 'vitest', 'run'],
      exitCode: 0,
      artifacts: [{ path: 'workers/w1/evidence/test.log', sha256: sha('all green\n') }],
      createdAt: new Date().toISOString(),
      ...fields,
    }),
  );
  return path;
}

const evidence = (params: Record<string, unknown>) => parent.call('pstack_evidence', { runId: 'run1', ...params });

describe('pstack_evidence', () => {
  test('verify is inconclusive, never pass, when no receipt exists', async () => {
    const result = await evidence({ action: 'verify', target: 'step-3' });
    expect(result.details).toEqual({ kind: 'inconclusive', reason: 'No receipt recorded for step-3', receipts: [] });
  });

  test('verify passes a recorded receipt whose artifacts still match', async () => {
    await evidence({ action: 'record', receiptPath: receipt('r1') });
    expect((await evidence({ action: 'verify', target: 'step-3' })).details).toEqual({ kind: 'pass', receipts: ['r1'] });
  });

  test('verify fails when an artifact changed after recording', async () => {
    await evidence({ action: 'record', receiptPath: receipt('r1') });
    writeFileSync(join(runRoot, 'workers', 'w1', 'evidence', 'test.log'), 'tampered\n');
    const result = await evidence({ action: 'verify', target: 'step-3' });
    expect(result.details).toMatchObject({ kind: 'fail', receipts: ['r1'], defects: ['r1: artifact workers/w1/evidence/test.log does not match its sha256'] });
  });

  test('verify fails a commit target that the receipt did not examine', async () => {
    await evidence({ action: 'record', receiptPath: receipt('r1', { target: 'a'.repeat(40) }) });
    expect((await evidence({ action: 'verify', target: 'a'.repeat(40) })).details.kind).toBe('fail');
  });

  test('a pass with no artifacts is inconclusive', async () => {
    await evidence({ action: 'record', receiptPath: receipt('r1', { artifacts: [] }) });
    expect((await evidence({ action: 'verify', target: 'step-3' })).details.kind).toBe('inconclusive');
  });

  test('record rejects a receipt outside the run and an artifact path that escapes it', async () => {
    const outside = join(project.home, 'r.json');
    writeFileSync(outside, '{}');
    await expect(evidence({ action: 'record', receiptPath: outside })).rejects.toThrow(/outside run run1/);
    await expect(evidence({ action: 'record', receiptPath: receipt('r2', { artifacts: [{ path: '../../../etc/passwd', sha256: sha('x') }] }) })).rejects.toThrow(/outside run run1/);
  });

  test('record is idempotent per receipt id and refuses a changed duplicate', async () => {
    const path = receipt('r1');
    await evidence({ action: 'record', receiptPath: path });
    await evidence({ action: 'record', receiptPath: path });
    expect((await evidence({ action: 'list' })).details.receipts).toHaveLength(1);
    await expect(evidence({ action: 'record', receiptPath: receipt('r1', { verdict: 'fail' }) })).rejects.toThrow(/different content/);
  });

  test('record rejects a malformed receipt', async () => {
    await expect(evidence({ action: 'record', receiptPath: receipt('r1', { verdict: 'probably' }) })).rejects.toThrow(/Invalid receipt/);
  });
});
