import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
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

  test('a fail receipt with an empty defect list verifies as fail', async () => {
    await evidence({ action: 'record', receiptPath: receipt('r1', { verdict: 'fail', defects: [] }) });
    expect((await evidence({ action: 'verify', target: 'step-3' })).details).toMatchObject({ kind: 'fail', receipts: ['r1'] });
  });

  test('a pass whose command exited non-zero verifies as fail', async () => {
    await evidence({ action: 'record', receiptPath: receipt('r1', { exitCode: 1 }) });
    expect((await evidence({ action: 'verify', target: 'step-3' })).details).toMatchObject({ kind: 'fail', receipts: ['r1'] });
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

describe('receipt files from concurrent processes', () => {
  const evidenceModule = join(PACKAGE_ROOT, 'src', 'evidence.ts');
  const node = (script: string, ...args: string[]) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    return { child, output: () => output, exited };
  };
  const recorder = (receiptPath: string) => node(`import { recordReceipt } from ${JSON.stringify(evidenceModule)}; await recordReceipt(process.argv[1], 'run1', process.argv[2]); process.stdout.write('RECORDED\\n');`, runRoot, receiptPath);
  const receiptsDir = () => join(runRoot, 'verification', 'receipts');
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  test('every recorder lands its own receipt file, with no shared file and no lock', async () => {
    const ids = Array.from({ length: 8 }, (_, index) => `c${index}`);
    const recorders = ids.map((id) => recorder(receipt(id)));
    children.push(...recorders.map((entry) => entry.child));
    expect(await Promise.all(recorders.map((entry) => entry.exited))).toEqual(ids.map(() => 0));
    expect(readdirSync(receiptsDir()).sort()).toEqual(ids.map((id) => `${id}.json`).sort());
    expect(existsSync(join(runRoot, 'verification', 'verdicts.json'))).toBe(false);
    expect((await evidence({ action: 'list' })).details.receipts.map((entry: { receipt: { id: string } }) => entry.receipt.id).sort()).toEqual(ids.sort());
    expect((await evidence({ action: 'verify', target: 'step-3' })).details).toMatchObject({ kind: 'pass' });
  });

  test('identical duplicates from racing processes are one receipt; a changed duplicate is rejected', async () => {
    const path = receipt('dup');
    const same = Array.from({ length: 6 }, () => recorder(path));
    children.push(...same.map((entry) => entry.child));
    expect(await Promise.all(same.map((entry) => entry.exited))).toEqual(same.map(() => 0));
    expect(readdirSync(receiptsDir())).toEqual(['dup.json']);

    const changed = recorder(receipt('dup', { verdict: 'fail' }));
    children.push(changed.child);
    expect(await changed.exited).not.toBe(0);
    expect(changed.output()).toMatch(/already recorded with different content/);
    expect((await evidence({ action: 'verify', target: 'step-3' })).details).toEqual({ kind: 'pass', receipts: ['dup'] });
  });

  test('a recorder killed mid-write leaves no partial receipt, and the id can be recorded afterwards', async () => {
    const path = receipt('big', { reason: 'x'.repeat(64 * 1024 * 1024) });
    const doomed = recorder(path);
    children.push(doomed.child);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && (!existsSync(receiptsDir()) || readdirSync(receiptsDir()).length === 0)) {
      // Spin, so the kill lands while the first file in receipts/ is still being written.
    }
    doomed.child.kill('SIGKILL');
    await doomed.exited;
    expect(readdirSync(receiptsDir()).length).toBeGreaterThan(0);
    expect(readdirSync(receiptsDir())).not.toContain('big.json');
    expect((await evidence({ action: 'list' })).details.receipts).toEqual([]);

    await evidence({ action: 'record', receiptPath: path });
    expect((await evidence({ action: 'list' })).details.receipts.map((entry: { receipt: { id: string } }) => entry.receipt.id)).toEqual(['big']);
  }, 60_000);
});
