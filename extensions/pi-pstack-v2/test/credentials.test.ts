import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { commandProviders, makeJobAgentDir, syncTokens } from '../src/credentials.ts';

let real: string;
let job: string;
const read = (dir: string) => JSON.parse(readFileSync(join(dir, 'auth.json'), 'utf8')) as Record<string, Record<string, unknown>>;
const write = (dir: string, data: unknown) => writeFileSync(join(dir, 'auth.json'), JSON.stringify(data));

beforeEach(() => {
  real = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-real-agent-')));
  job = join(realpathSync(mkdtempSync(join(tmpdir(), 'pstack-job-'))), 'agent');
  writeFileSync(join(real, 'settings.json'), '{}');
  write(real, {
    oauth: { type: 'oauth', access: 'a1', refresh: 'r1', expires: 100 },
    literal: { type: 'api_key', key: 'sk-literal' },
    command: { type: 'api_key', key: '!op read secret' },
    other: { type: 'api_key', key: '!op read other' },
  });
});

afterEach(() => {
  rmSync(real, { recursive: true, force: true });
  rmSync(join(job, '..'), { recursive: true, force: true });
});

describe('a job agent directory', () => {
  test('links your configuration and copies credentials without any command', () => {
    writeFileSync(join(real, 'keybindings.json'), '{}');
    makeJobAgentDir(real, job);
    expect(lstatSync(join(job, 'keybindings.json')).isSymbolicLink()).toBe(true);
    expect(Object.keys(read(job)).sort()).toEqual(['literal', 'oauth']);
    expect(commandProviders(real).sort()).toEqual(['command', 'other']);
  });

  test("carries only the worker's own resolved command", () => {
    makeJobAgentDir(real, job, { command: 'sk-resolved' });
    expect([read(job)['command']?.['key'], read(job)['other']]).toEqual(['sk-resolved', undefined]);
  });

  test('keeps local packages in settings resolving to the same place', () => {
    writeFileSync(join(real, 'settings.json'), JSON.stringify({ packages: ['../pkg-a', 'npm:@x/y', { source: './pkg-b', skills: [] }], extensions: ['ext/one.ts'], theme: 'dark' }));
    makeJobAgentDir(real, job);
    const settings = JSON.parse(readFileSync(join(job, 'settings.json'), 'utf8'));
    expect(lstatSync(join(job, 'settings.json')).isSymbolicLink()).toBe(false);
    expect(settings).toEqual({ packages: [join(real, '../pkg-a'), 'npm:@x/y', { source: join(real, 'pkg-b'), skills: [] }], extensions: [join(real, 'ext/one.ts')], theme: 'dark' });
  });

  test('never links pstack state or your sessions into the job', () => {
    for (const name of ['pstack-v2', 'sessions']) writeFileSync(join(real, name), '');
    makeJobAgentDir(real, job);
    expect([existsSync(join(job, 'pstack-v2')), existsSync(join(job, 'sessions'))]).toEqual([false, false]);
  });
});

describe('token sync', () => {
  beforeEach(() => makeJobAgentDir(real, job));

  test("brings a job's refreshed token back, and nothing else it wrote", () => {
    write(job, { ...read(job), oauth: { type: 'oauth', access: 'a2', refresh: 'r2', expires: 200 }, literal: { type: 'api_key', key: '!touch /tmp/pwned' }, planted: { type: 'api_key', key: '!touch /tmp/pwned' } });
    expect(syncTokens(real, job)).toBe(true);
    expect([read(real)['oauth']?.['refresh'], read(real)['literal']?.['key'], read(real)['planted']]).toEqual(['r2', 'sk-literal', undefined]);
  });

  test('sends a token the root refreshed down to the job', () => {
    write(real, { ...read(real), oauth: { type: 'oauth', access: 'a3', refresh: 'r3', expires: 300 } });
    syncTokens(real, job);
    expect(read(job)['oauth']?.['refresh']).toBe('r3');
  });

  test('never brings back a provider you logged out of', () => {
    const { oauth: _, ...rest } = read(real);
    write(real, rest);
    write(job, { ...read(job), oauth: { type: 'oauth', access: 'a4', refresh: 'r4', expires: 400 } });
    syncTokens(real, job);
    expect(read(real)['oauth']).toBeUndefined();
  });

  test('waits when Pi holds the credentials lock', () => {
    write(job, { ...read(job), oauth: { type: 'oauth', access: 'a5', refresh: 'r5', expires: 500 } });
    writeFileSync(join(real, 'placeholder'), '');
    const lock = join(real, 'auth.json.lock');
    mkdirSync(lock);
    expect(syncTokens(real, job)).toBe(false);
    expect(read(real)['oauth']?.['refresh']).toBe('r1');
  });
});
