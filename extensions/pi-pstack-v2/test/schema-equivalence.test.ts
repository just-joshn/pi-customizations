import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { hostEnv } from '../src/host-env.ts';
import { list, read, readSpec } from '../src/jobs.ts';

const OWNER = 'owner';
const WRITABLE = '/writable';
const FUTURE_KEY_VALUE = { nested: [1] };
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

describe('the process environment', () => {
  test('is the same variables, order, and values as process.env', () => {
    const env = hostEnv();
    const expected = envObject.parse(process.env);
    expect(Object.entries(env)).toStrictEqual(Object.entries(expected));
    expect(env['PATH']).toBe(expected['PATH']);
  });
});

const specBody = (over: Record<string, unknown> = {}): string => JSON.stringify({ id: 'a', owner: OWNER, kind: 'command', brokered: true, out: join(work, 'out'), ...over });

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
