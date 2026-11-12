// Abort removes a worker's container on the engine spawn recorded, not on whatever the environment says when abort runs.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connectEngine, DEFAULT_IMAGE, engineRecordPath, removeRecordedContainers, writeEngineRecord } from '../../src/container.ts';

function pinnedEngineHost(): string | undefined {
  if (process.env['DOCKER_HOST']) return process.env['DOCKER_HOST'];
  const host = execFileSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).trim();
  return host === '' ? undefined : host;
}
const ENGINE_HOST = pinnedEngineHost();
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', env: { ...process.env, ...(ENGINE_HOST === undefined ? {} : { DOCKER_HOST: ENGINE_HOST }) } }).trim();

const NAME = `pstack_u13f_${randomBytes(3).toString('hex')}_abcd1234`;
let dir: string;
let before: string | undefined;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-engine-record-'));
  mkdirSync(join(dir, 'claim'));
  const engine = await connectEngine({ ...process.env, ...(ENGINE_HOST === undefined ? {} : { DOCKER_HOST: ENGINE_HOST }) });
  writeEngineRecord(dir, engine);
  before = process.env['DOCKER_HOST'];
}, 60_000);
afterAll(() => {
  if (before === undefined) delete process.env['DOCKER_HOST'];
  else process.env['DOCKER_HOST'] = before;
  const left = docker('ps', '--all', '--quiet', '--filter', `label=pstack.worker=${NAME}`).split('\n').filter(Boolean);
  if (left.length > 0) docker('rm', '--force', ...left);
  rmSync(dir, { recursive: true, force: true });
});

describe('removing a worker container at abort', () => {
  test('uses the engine recorded at spawn even when the environment now points elsewhere', async () => {
    docker('run', '-d', '--label', `pstack.worker=${NAME}`, '--entrypoint', 'sleep', DEFAULT_IMAGE, '300');
    expect(docker('ps', '--quiet', '--filter', `label=pstack.worker=${NAME}`)).not.toBe('');
    process.env['DOCKER_HOST'] = 'unix:///nonexistent/pstack-test-docker.sock';

    const removed = await removeRecordedContainers(dir, NAME);

    expect(removed).toHaveLength(1);
    expect(docker('ps', '--all', '--quiet', '--filter', `label=pstack.worker=${NAME}`)).toBe('');
  }, 60_000);

  test('says so when no engine was recorded, instead of guessing one from the environment', async () => {
    rmSync(engineRecordPath(dir));

    await expect(removeRecordedContainers(dir, NAME)).rejects.toThrow(/the engine this worker's container ran on is unknown/);
  });
});
