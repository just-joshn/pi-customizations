import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ReceiptSchema, registerEvidenceTool } from '../../src/evidence.ts';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { makeParent, makeProject, makeRun, type Parent, type Project, until } from './harness.ts';

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

  test('an intended failing-before proof records as expectedFail and verifies as pass only when the command failed', async () => {
    await evidence({ action: 'record', receiptPath: receipt('red', { target: 'step-3-before', expectedFail: true, exitCode: 1 }) });
    expect((await evidence({ action: 'verify', target: 'step-3-before' })).details).toEqual({ kind: 'pass', receipts: ['red'] });
    await evidence({ action: 'record', receiptPath: receipt('green-claimed-red', { target: 'step-4-before', expectedFail: true, exitCode: 0 }) });
    expect((await evidence({ action: 'verify', target: 'step-4-before' })).details).toMatchObject({ kind: 'fail', defects: ['green-claimed-red: expected the command to fail, but it exited 0'] });
    const bare = receipt('red-no-exit', { target: 'step-5-before', expectedFail: true });
    writeFileSync(bare, JSON.stringify({ ...JSON.parse(readFileSync(bare, 'utf8')), exitCode: undefined }));
    await evidence({ action: 'record', receiptPath: bare });
    expect((await evidence({ action: 'verify', target: 'step-5-before' })).details).toMatchObject({ kind: 'inconclusive' });
  });

  test('a non-zero pass without expectedFail still fails, and says how to record an intended failure', async () => {
    await evidence({ action: 'record', receiptPath: receipt('r1', { exitCode: 2 }) });
    expect((await evidence({ action: 'verify', target: 'step-3' })).details).toMatchObject({ kind: 'fail', defects: [expect.stringContaining('set expectedFail: true')] });
  });

  test('an expected-fail receipt with a pass-claiming artifact still fails when the artifact changed', async () => {
    await evidence({ action: 'record', receiptPath: receipt('red', { target: 'step-3-before', expectedFail: true, exitCode: 1 }) });
    writeFileSync(join(runRoot, 'workers', 'w1', 'evidence', 'test.log'), 'tampered\n');
    expect((await evidence({ action: 'verify', target: 'step-3-before' })).details.kind).toBe('fail');
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

  test('record rejects a malformed receipt and names its path and the offending property', async () => {
    const path = receipt('r1', { verdict: 'probably' });
    await expect(evidence({ action: 'record', receiptPath: path })).rejects.toThrow(new RegExp(`Invalid receipt ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: .*verdict`));
  });

  test('a validation error names each bad field with the values it allows, once per field', async () => {
    const kind = receipt('r1', { kind: 'unit-test', verdict: 'passed' });
    await expect(evidence({ action: 'record', receiptPath: kind })).rejects.toThrow(/kind: [^;]*\(must be one of test, command, screenshot, trace, review, measurement, other\); verdict: [^;]*\(must be one of pass, fail, inconclusive\)$/);
    const extra = receipt('r2', { receipt: {}, receiptPath: 'x' });
    await expect(evidence({ action: 'record', receiptPath: extra })).rejects.toThrow(/receipt: unknown field \(allowed fields: schemaVersion, id, runId, target, kind, verdict, commit, environment, command, exitCode, artifacts, defects, reason, expectedFail, createdAt\)/);
    const missing = receipt('r3');
    writeFileSync(missing, JSON.stringify({ schemaVersion: 1, id: 'r3', runId: 'run1', target: 't', kind: 'test', verdict: 'pass', commit: null, environment: 'x', artifacts: [] }));
    await expect(evidence({ action: 'record', receiptPath: missing })).rejects.toThrow(/createdAt: missing \(must be an ISO timestamp string\)/);
  });

  test('the tool description lists the receipt fields and the kind enum', async () => {
    let tools = '';
    registerEvidenceTool({ registerTool: (tool: { description: string }) => (tools = tool.description) } as unknown as ExtensionAPI);
    expect(tools).toContain('kind (one of test, command, screenshot, trace, review, measurement, other)');
    expect(tools).toContain('createdAt (an ISO timestamp string)');
    expect(tools).toContain('expectedFail');
  });

  test('the worker reference and the tool description document every schema field and kind', () => {
    const reference = readFileSync(join(PACKAGE_ROOT, 'generated/skills/poteto-mode/references/worker-assignment.md'), 'utf8');
    let description = '';
    registerEvidenceTool({ registerTool: (tool: { description: string }) => (description = tool.description) } as unknown as ExtensionAPI);
    const kinds = (ReceiptSchema.properties.kind.anyOf as { const: string }[]).map((entry) => entry.const);
    for (const text of [reference, description]) for (const word of [...Object.keys(ReceiptSchema.properties), ...kinds]) expect(text, word).toContain(word);
  });

  test('record names a missing property', async () => {
    const path = receipt('r1');
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, id: 'r1', runId: 'run1' }));
    await expect(evidence({ action: 'record', receiptPath: path })).rejects.toThrow(/Invalid receipt .*r1\.json: .*target/);
  });

  test('a relative path that exists under the project directory records, as does one relative to the run root', async () => {
    const full = receipt('r1');
    await evidence({ action: 'record', receiptPath: relative(project.dir, full) });
    await evidence({ action: 'record', receiptPath: relative(runRoot, receipt('r2')) });
    expect((await evidence({ action: 'list' })).details.receipts.map((entry: { receipt: { id: string } }) => entry.receipt.id).sort()).toEqual(['r1', 'r2']);
  });

  test('a relative path found under neither base says where it looked', async () => {
    await expect(evidence({ action: 'record', receiptPath: 'nowhere/r9.json' })).rejects.toThrow(/is not a file \(looked at .*nowhere\/r9\.json, .*run1\/nowhere\/r9\.json\)/);
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
    const path = receipt('killed');
    // The child's temporary-file write stops halfway and reports it, so the kill always lands mid-write.
    const doomed = node(
      `import fs, { writeSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const write = fs.writeFileSync;
      fs.writeFileSync = (file, data, options) => {
        if (!String(file).endsWith('.tmp')) return write(file, data, options);
        write(file, data.slice(0, data.length >> 1), options);
        writeSync(1, 'PARTIAL\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      };
      syncBuiltinESMExports();
      const { recordReceipt } = await import(${JSON.stringify(evidenceModule)});
      recordReceipt(process.argv[1], 'run1', process.argv[2]);`,
      runRoot,
      path,
    );
    children.push(doomed.child);
    await until(doomed.output, (output) => output.includes('PARTIAL'), 30_000, 'the recorder to write half its temporary file');
    doomed.child.kill('SIGKILL');
    await doomed.exited;
    const [temporary, ...others] = readdirSync(receiptsDir());
    expect(others).toEqual([]);
    expect(temporary).toMatch(/^\.killed\..*\.tmp$/);
    expect(() => JSON.parse(readFileSync(join(receiptsDir(), temporary as string), 'utf8'))).toThrow();
    expect((await evidence({ action: 'list' })).details.receipts).toEqual([]);

    await evidence({ action: 'record', receiptPath: path });
    expect((await evidence({ action: 'list' })).details.receipts.map((entry: { receipt: { id: string } }) => entry.receipt.id)).toEqual(['killed']);
  });
});
