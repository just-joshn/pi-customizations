import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { makeParent, makeProject, makeRun, type Parent, type Project, sleep, until } from './harness.ts';

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

describe('verdicts lock', () => {
  const evidenceModule = join(PACKAGE_ROOT, 'src', 'evidence.ts');
  const node = (script: string, ...args: string[]) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    return { child, output: () => output, exited };
  };
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  test('a paused owner keeps the lock past the stale age, and concurrent recorders wait for its release', async () => {
    const owner = node(
      `import { withVerdictsLock } from ${JSON.stringify(evidenceModule)}; await withVerdictsLock(process.argv[1], () => { process.stdout.write('HELD\\n'); process.kill(process.pid, 'SIGSTOP'); }); process.stdout.write('RELEASED\\n');`,
      runRoot,
    );
    children.push(owner.child);
    await until(owner.output, (text) => text.includes('HELD'), 10_000, 'owner holds the lock');
    const lock = join(runRoot, 'verification', 'verdicts.lock');
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);

    const record = (id: string) => node(`import { recordReceipt } from ${JSON.stringify(evidenceModule)}; await recordReceipt(process.argv[1], 'run1', process.argv[2]); process.stdout.write('RECORDED\\n');`, runRoot, receipt(id));
    const recorders = [record('r1'), record('r2')];
    children.push(...recorders.map((recorder) => recorder.child));
    await sleep(1_500);
    expect(recorders.map((recorder) => recorder.output())).toEqual(['', '']);
    expect(existsSync(join(runRoot, 'verification', 'verdicts.json'))).toBe(false);

    owner.child.kill('SIGCONT');
    expect(await owner.exited).toBe(0);
    expect(owner.output()).toContain('RELEASED');
    expect(await Promise.all(recorders.map((recorder) => recorder.exited))).toEqual([0, 0]);
    const recorded = JSON.parse(readFileSync(join(runRoot, 'verification', 'verdicts.json'), 'utf8')).receipts.map((entry: { receipt: { id: string } }) => entry.receipt.id);
    expect(recorded.sort()).toEqual(['r1', 'r2']);
  });

  test("a dead owner's lock is reclaimed", async () => {
    const owner = node(`import { withVerdictsLock } from ${JSON.stringify(evidenceModule)}; await withVerdictsLock(process.argv[1], () => { process.stdout.write('HELD\\n'); process.kill(process.pid, 'SIGSTOP'); });`, runRoot);
    children.push(owner.child);
    await until(owner.output, (text) => text.includes('HELD'), 10_000, 'owner holds the lock');
    owner.child.kill('SIGKILL');
    await owner.exited;
    await evidence({ action: 'record', receiptPath: receipt('r1') });
    expect((await evidence({ action: 'list' })).details.receipts).toHaveLength(1);
  });
});
