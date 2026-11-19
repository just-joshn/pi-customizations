import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { makeJobAgentDir } from '../src/credentials.ts';
import { hostEnv } from '../src/host-env.ts';
import { list, read, readSpec } from '../src/jobs.ts';
import { SandboxPolicySchema } from '../src/sandbox.ts';

const SWEEP_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sweep.ts');
const OWNER = 'owner';
const BOM = '\ufeff';
const WRITABLE = '/writable';
const FUTURE_KEY_VALUE = { nested: [1] };
const jsonObject = z.record(z.string(), z.unknown());
const envObject = z.object({}).catchall(z.string());

let work: string;

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-equivalence-')));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const writeText = (file: string, text: string): string => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};

describe('credentials copy', () => {
  const copyOf = (auth: string): Record<string, unknown> => {
    const real = join(work, 'real');
    writeText(join(real, 'auth.json'), auth);
    makeJobAgentDir(real, join(work, 'job'));
    return jsonObject.parse(JSON.parse(readFileSync(join(work, 'job', 'auth.json'), 'utf8')));
  };

  test('keeps entries of any shape, and their order, as Pi reads them', () => {
    const auth = { zeta: { type: 'api_key', key: 'k', extra: [1, { deep: null }] }, alpha: null, beta: 'text', gamma: 7 };
    const copy = copyOf(`${BOM}${JSON.stringify(auth)}`);
    expect(copy).toStrictEqual(auth);
    expect(Object.keys(copy)).toEqual(['zeta', 'alpha', 'beta', 'gamma']);
  });

  test.each([
    ['an array', '[1, 2]'],
    ['null', 'null'],
    ['a string', '"text"'],
    ['malformed JSON', '{'],
  ])('copies no credentials from %s', (_label, auth) => {
    expect(copyOf(auth)).toStrictEqual({});
  });
});

describe('the process environment', () => {
  test('is the same variables, order, and values as process.env', () => {
    const env = hostEnv();
    const expected = envObject.parse(process.env);
    expect(Object.entries(env)).toStrictEqual(Object.entries(expected));
    expect(env['PATH']).toBe(expected['PATH']);
  });
});

const specBody = (over: Record<string, unknown> = {}): string => JSON.stringify({ id: 'a', owner: OWNER, kind: 'command', brokered: true, out: join(work, 'out'), policy: { writable: [], protect: [], lock: [], gitDirs: [] }, ...over });

describe('a job spec read from disk', () => {
  test('is returned exactly as written, with any key missing or extra', () => {
    const body = { zeta: 1, owner: OWNER, id: 'a', future: FUTURE_KEY_VALUE, brokered: true, policy: { writable: [WRITABLE] } };
    writeText(join(work, 'a', 'job.json'), JSON.stringify(body));
    const spec = readSpec(join(work, 'a'));
    expect(spec).toStrictEqual(body);
    expect(Object.keys(spec ?? {})).toEqual(Object.keys(body));
  });

  test('keeps a null or missing optional key as written', () => {
    writeText(join(work, 'a', 'job.json'), specBody({ wake: null, tmp: undefined, createWorktree: null }));
    expect(readSpec(join(work, 'a'))).toMatchObject({ wake: null, createWorktree: null });
  });

  test('belongs to its owner even when older versions left keys out', () => {
    writeText(join(work, 'a', 'job.json'), specBody());
    expect(read(work, 'a', OWNER)?.spec.id).toBe('a');
    expect(list(work, OWNER).map((job) => job.spec.id)).toEqual(['a']);
    expect(read(work, 'a', 'someone else')).toBeUndefined();
  });

  test.each([
    ['malformed JSON', '{'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"owner"'],
  ])('is not a job when job.json holds %s', (_label, body) => {
    writeText(join(work, 'a', 'job.json'), body);
    expect(read(work, 'a', OWNER)).toBeUndefined();
  });
});

describe('a sandbox policy read from disk', () => {
  test('is returned as written, without the keys older versions did not have', () => {
    const policy = { writable: [WRITABLE], future: true, protect: [] };
    const parsed = SandboxPolicySchema.parse(policy);
    expect(parsed).toStrictEqual(policy);
    expect(Object.keys(parsed)).toEqual(['writable', 'future', 'protect']);
  });
});

describe('the sweep script', () => {
  const sweepWith = (inventory: Record<string, unknown>): { status: number | null; output: string; moved: boolean } => {
    const root = join(work, 'root');
    const planted = writeText(join(root, 'sub', '.vscode', 'tasks.json'), '{}');
    const output = join(work, 'output.log');
    const quarantine = join(work, 'quarantine');
    writeText(output, '');
    writeText(join(work, 'inventory.json'), JSON.stringify({ roots: [root], absent: [], present: [], quarantine, output, ...inventory }));
    const run = spawnSync(process.execPath, [SWEEP_SCRIPT, join(work, 'inventory.json')], { encoding: 'utf8' });
    return { status: run.status, output: readFileSync(output, 'utf8'), moved: !existsSync(planted) };
  };

  test('treats an inventory without present as listing no code that was already there', () => {
    const result = sweepWith({ present: undefined });
    expect(result).toMatchObject({ status: 0, moved: true });
  });

  test('reports a damaged inventory in the job output instead of failing silently', () => {
    const result = sweepWith({ absent: undefined });
    expect(result.status).toBe(0);
    expect(result.output).toContain('pstack could not finish checking this job');
  });
});
