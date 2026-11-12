// A container worker records its own receipts. The host takes each into the run's receipts under the same exclusive-link rules.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { evidenceScope, ingestContainerReceipts, listReceipts, recordReceipt, verifyTarget } from '../../src/evidence.ts';
import type { RunId } from '../../src/run-files.ts';
import { makeProject, makeRun, type Project } from '../worker-lifecycle/harness.ts';

const RUN = 'run1' as RunId;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

let project: Project;
let runRoot: string;

beforeEach(() => {
  project = makeProject();
  runRoot = makeRun(project, RUN);
});
afterEach(() => project.dispose());

/** What a container worker's evidence tool sees: the run root's name, and only its own directory behind it. */
function inContainer(workerId: string) {
  const workerDir = join(runRoot, 'workers', workerId);
  const out = join(workerDir, 'out');
  mkdirSync(join(out, 'evidence'), { recursive: true });
  mkdirSync(join(out, 'receipts'), { recursive: true });
  // In the container `out` is the worker directory itself; these links give the host-side test the same view.
  for (const name of ['evidence', 'receipts']) if (!existsSync(join(workerDir, name))) symlinkSync(join('out', name), join(workerDir, name));
  const scope = evidenceScope(project.dir, RUN, { PSTACK_CONTAINER: '1', PSTACK_RUN_ROOT: runRoot, PSTACK_WORKER_ID: workerId });
  return {
    workerDir,
    out,
    scope,
    /** Writes an artifact and a receipt for it the way the worker would, in out/evidence, and records it. */
    record(id: string, target = 'step-1', content = 'all green\n', verdict: 'pass' | 'fail' = 'pass') {
      writeFileSync(join(out, 'evidence', `${id}.log`), content);
      const path = join(out, 'evidence', `${id}.json`);
      writeFileSync(
        path,
        JSON.stringify({
          schemaVersion: 1,
          id,
          runId: RUN,
          target,
          kind: 'test',
          verdict,
          commit: project.commit,
          environment: 'container',
          artifacts: [{ path: join(workerDir, 'evidence', `${id}.log`), sha256: digest(content) }],
          createdAt: '2026-11-12T00:00:00.000Z',
        }),
      );
      return recordReceipt(scope, RUN, join(workerDir, 'evidence', `${id}.json`));
    },
  };
}

describe('a receipt recorded inside a container worker', () => {
  test('is created by the worker in its own inbox, without the run root', () => {
    const worker = inContainer('v1');

    const recorded = worker.record('r1');

    expect(recorded.receipt).toMatchObject({ id: 'r1', target: 'step-1', verdict: 'pass' });
    expect(readdirSync(join(worker.out, 'receipts'))).toEqual(['r1.json']);
    expect(existsSync(join(runRoot, 'verification'))).toBe(false);
  });

  test('the worker cannot record outside its own directory, and the exclusive-link rule holds in the inbox', () => {
    const worker = inContainer('v1');
    writeFileSync(join(runRoot, 'elsewhere.json'), '{}');

    expect(() => recordReceipt(worker.scope, RUN, join(runRoot, 'elsewhere.json'))).toThrow(/outside this worker's directory/);
    worker.record('r1');
    expect(() => worker.record('r1', 'step-1', 'different\n')).toThrow(/already recorded with different content/);
    expect(worker.record('r1').receipt.id).toBe('r1');
  });

  test('joins the run when the host reads its receipts, as a file of the host\'s own, and verifies', () => {
    const worker = inContainer('v1');
    worker.record('r1');

    const verdict = verifyTarget(runRoot, RUN, 'step-1');

    expect(verdict).toEqual({ kind: 'pass', receipts: ['r1'] });
    const stored = join(runRoot, 'verification', 'receipts', 'r1.json');
    const inbox = join(worker.out, 'receipts', 'r1.json');
    expect(statSync(stored).ino).not.toBe(statSync(inbox).ino);
    expect(statSync(stored).nlink).toBe(1);
  });

  test('ingesting twice stores nothing new, and a later rewrite of the inbox file does not change the recorded receipt', () => {
    const worker = inContainer('v1');
    worker.record('r1');
    const first = ingestContainerReceipts(runRoot, RUN);
    const stored = readFileSync(join(runRoot, 'verification', 'receipts', 'r1.json'), 'utf8');

    writeFileSync(join(worker.out, 'receipts', 'r1.json'), JSON.stringify({ receipt: { tampered: true } }));
    const second = ingestContainerReceipts(runRoot, RUN);

    expect(first).toEqual({ recorded: ['r1'], rejected: [] });
    expect(second.recorded).toEqual([]);
    expect(second.rejected).toHaveLength(1);
    expect(readFileSync(join(runRoot, 'verification', 'receipts', 'r1.json'), 'utf8')).toBe(stored);
    expect(listReceipts(runRoot, RUN).map(({ receipt }) => receipt.id)).toEqual(['r1']);
  });

  test('cannot replace a receipt the run already holds, and says which was rejected', () => {
    mkdirSync(join(runRoot, 'workers', 'host'), { recursive: true });
    const first = inContainer('v1');
    first.record('r1', 'step-1', 'first\n');
    ingestContainerReceipts(runRoot, RUN);
    const second = inContainer('v2');
    second.record('r1', 'step-1', 'second\n', 'fail');

    const { recorded, rejected } = ingestContainerReceipts(runRoot, RUN);

    expect(recorded).toEqual(['r1']);
    expect(rejected).toEqual([{ workerId: 'v2', file: 'r1.json', reason: expect.stringMatching(/already recorded with different content/) }]);
    expect(verifyTarget(runRoot, RUN, 'step-1')).toEqual({ kind: 'pass', receipts: ['r1'] });
  });

  test('rejects an inbox entry that is a symlink, names a file outside the worker, or is not a receipt', () => {
    const worker = inContainer('v1');
    writeFileSync(join(runRoot, 'host-file'), 'host\n');
    symlinkSync(join(runRoot, 'run.json'), join(worker.out, 'receipts', 'linked.json'));
    writeFileSync(join(worker.out, 'receipts', 'junk.json'), '{"receipt":{"nope":1}}');
    writeFileSync(
      join(worker.out, 'receipts', 'outside.json'),
      JSON.stringify({ receipt: { schemaVersion: 1, id: 'outside', runId: RUN, target: 't', kind: 'test', verdict: 'pass', commit: null, environment: 'x', artifacts: [{ path: join(runRoot, 'host-file'), sha256: digest('host\n') }], createdAt: 'now' } }),
    );

    const { recorded, rejected } = ingestContainerReceipts(runRoot, RUN);

    expect(recorded).toEqual([]);
    expect(rejected.map(({ file }) => file).sort()).toEqual(['junk.json', 'linked.json', 'outside.json']);
    expect(rejected.find(({ file }) => file === 'outside.json')?.reason).toMatch(/not in the worker's own directory/);
  });

  test('an artifact the worker swapped for a symlink fails verification instead of being read', () => {
    const worker = inContainer('v1');
    worker.record('r1');
    const artifact = join(worker.out, 'evidence', 'r1.log');
    writeFileSync(join(runRoot, 'host-secret'), 'all green\n');
    rmSync(artifact);
    symlinkSync(join(runRoot, 'host-secret'), artifact);

    const verdict = verifyTarget(runRoot, RUN, 'step-1');

    expect(verdict).toMatchObject({ kind: 'fail', defects: [expect.stringMatching(/r1: artifact .*r1\.log is not a regular file/)] });
  });
});
