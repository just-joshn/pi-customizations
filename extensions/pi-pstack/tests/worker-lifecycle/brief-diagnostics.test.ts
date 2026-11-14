import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { parseRunId, readBrief } from '../../src/run-files.ts';
import { spawnAssignment } from '../../src/workers.ts';
import { makeProject, makeRun, type Project, workerDir, writeAssignment } from './harness.ts';

let project: Project;
let assignmentPath: string;
let dir: string;
let briefPath: string;

beforeEach(() => {
  project = makeProject('pstack-brief-');
  makeRun(project, 'r');
  assignmentPath = writeAssignment(project, 'r', 'w', 'Read this brief.');
  dir = workerDir(project, 'r', 'w');
  briefPath = join(dir, 'brief.md');
});

afterEach(() => project.dispose());

const spawn = () =>
  spawnAssignment(project.dir, parseRunId('r'), assignmentPath, {
    agentsDir: project.agentsDir,
    resolveModel: async () => null,
    exec: async () => {
      throw new Error('Invalid input must fail before launching tmux');
    },
  });

test('spawn names the missing brief path and tells the caller to finish writing it before spawning', async () => {
  rmSync(briefPath);
  const error: unknown = await spawn().catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    message: `Brief file not found. Write or finish writing brief.md at ${briefPath} before spawning the worker`,
    cause: expect.objectContaining({ code: 'ENOENT', path: briefPath }),
  });
  expect(existsSync(join(dir, 'claim'))).toBe(false);
  writeFileSync(briefPath, 'Finished brief.');
  expect(readBrief(dir).toString('utf8')).toBe('Finished brief.');
});

test('spawn keeps the existing missing-assignment diagnostic', async () => {
  rmSync(assignmentPath);
  await expect(spawn()).rejects.toThrow(`Assignment file not found. Write assignment.json at ${assignmentPath} before spawning the worker`);
  expect(existsSync(join(dir, 'claim'))).toBe(false);
});

test('spawn still rejects a brief directory as a non-regular file', async () => {
  rmSync(briefPath);
  mkdirSync(briefPath);
  await expect(spawn()).rejects.toThrow(`${briefPath} must be a regular file`);
  expect(existsSync(join(dir, 'claim'))).toBe(false);
});

test('spawn still rejects a symlink brief without reading its target', async () => {
  rmSync(briefPath);
  symlinkSync(join(project.dir, 'README.md'), briefPath);
  await expect(spawn()).rejects.toThrow(`${briefPath} must be a regular file, not a symlink`);
  expect(existsSync(join(dir, 'claim'))).toBe(false);
});

test('readBrief preserves the filesystem code and path for an unrelated open failure', () => {
  const parentFile = join(dir, 'parent-file');
  writeFileSync(parentFile, 'not a directory');
  expect(() => readBrief(parentFile)).toThrow(expect.objectContaining({ code: 'ENOTDIR', path: join(parentFile, 'brief.md') }));
});
