// Recording relies on hard links. A filesystem without them must fail recording with a clear requirement.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { recordReceipt } from '../../src/evidence.ts';
import type { RunId } from '../../src/run-files.ts';
import { makeProject, makeRun, type Project } from './harness.ts';

const linkFailure = vi.hoisted(() => ({ code: undefined as string | undefined }));

vi.mock(import('node:fs'), async (importOriginal) => {
  const fs = await importOriginal();
  const linkSync: typeof fs.linkSync = (existing, created) => {
    if (linkFailure.code === undefined) return fs.linkSync(existing, created);
    throw Object.assign(new Error(`${linkFailure.code}: link failed`), { code: linkFailure.code });
  };
  return { ...fs, linkSync, default: { ...fs, linkSync } };
});

let project: Project;
let runRoot: string;

beforeEach(() => {
  project = makeProject();
  runRoot = makeRun(project, 'run1');
});

afterEach(() => {
  linkFailure.code = undefined;
  project.dispose();
});

function receipt(id: string): string {
  const dir = join(runRoot, 'workers', 'w1', 'evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'test.log'), 'all green\n');
  const path = join(dir, `${id}.json`);
  const artifacts = [{ path: 'workers/w1/evidence/test.log', sha256: createHash('sha256').update('all green\n').digest('hex') }];
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, id, runId: 'run1', target: 'step-3', kind: 'test', verdict: 'pass', commit: project.commit, environment: 'node', artifacts, createdAt: new Date().toISOString() }));
  return path;
}

test.for(['ENOTSUP', 'EPERM', 'EXDEV', 'EMLINK'])('a %s from the hard link names the filesystem requirement and records nothing', (code) => {
  linkFailure.code = code;
  expect(() => recordReceipt(runRoot, 'run1' as RunId, receipt('r1'))).toThrow(/hard links/);
  const dir = join(runRoot, 'verification', 'receipts');
  expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
});
