#!/usr/bin/env node
// Proves every rule detector fires on a known-bad fixture and stays quiet on a clean one.
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analyzeSource, configViolations } from './check-vitest-conventions.mjs';

const bad = `
import { describe, expect, it, test, vi } from 'vitest';
process.env.SOME_FLAG = '1';
globalThis.someGlobal = 1;
vi.mock('./dependency.js', () => ({}));
test('truthy', () => {
  const value = 1;
  expect(value).toBeTruthy();
  expect(value).toBeDefined();
});
test('jest apis', () => {
  expect(jest.fn()).toHaveBeenCalled();
});
test('sync throw', () => {
  const parse = () => { throw new Error('boom'); };
  expect(parse()).toThrow('boom');
});
test('async expectation', () => {
  expect(Promise.reject(new Error('boom'))).rejects.toThrow('boom');
});
test('uses jest globals', async () => {
  const { fn } = await import('@jest/globals');
  expect(fn).toBeDefined();
});
test('real timer', async () => {
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(1).toBe(1);
});
test('snapshot', () => {
  expect({ a: 1 }).toMatchInlineSnapshot();
});
test('concurrent work', () => {
  expect(2).toBe(2);
});
it.concurrent('parallel case', () => {
  expect(3).toBe(3);
});
describe('outer', () => {
  describe('middle', () => {
    describe('inner', () => {
      it('nested', () => {
        expect(4).toBe(4);
      });
    });
  });
});
`;

const clean = `
import { describe, expect, it, test, vi } from 'vitest';

describe('parseArgs', () => {
  it('returns the parsed value', () => {
    expect(parseArgs(['--count', '2'])).toEqual({ count: 2 });
  });
});

test('reads a stubbed environment value', () => {
  vi.stubEnv('SOME_FLAG', 'on');
  expect(readFlag()).toBe('on');
});

test('rejects an invalid value', async () => {
  await expect(load('bad')).rejects.toThrow('invalid');
});

test('names each case', () => {
  expect(() => parse('')).toThrow('empty');
  expect(parse('ok')).toBe('ok');
});
`;

const delegating = `
import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

async function checkLink(file: string) {
  const text = await readFile(file, 'utf8');
  expect(text).toMatch(/ok/);
}

async function verifyDirectory(dir: string) {
  await checkLink(dir);
}

test('verifies links through helpers', async () => {
  await verifyDirectory('/tmp/links');
});

test('awaits a deferred expectation in a batch', async () => {
  const pending = expect(Promise.reject(new Error('nope'))).rejects.toThrow('nope');
  await Promise.all([pending, Promise.resolve()]);
});
`;

const noAssertion = `
import { test } from 'vitest';

test('does nothing at all', () => {
  const value = 1;
  void value;
});
`;

const badRules = new Set(analyzeSource(bad, 'bad.test.ts').map((item) => item.rule));
for (const rule of [
  'unmanaged-env-mutation',
  'unmanaged-global-mutation',
  'string-module-mock',
  'truthy-matcher',
  'weak-only-assertion',
  'jest-api',
  'unwrapped-throw',
  'unawaited-async-expect',
  'real-wait',
  'snapshot',
  'concurrent-test',
  'describe-nesting',
]) {
  assert.ok(badRules.has(rule), `expected ${rule} to fire on the bad fixture`);
}
assert.ok(!badRules.has('no-assertion'), 'expected the bad fixture to make assertions');

const cleanItems = analyzeSource(clean, 'clean.test.ts');
const cleanViolations = cleanItems.filter((item) => item.severity === 'violation');
assert.deepEqual(cleanViolations, [], `clean fixture must produce no violations: ${JSON.stringify(cleanViolations)}`);

const delegatingViolations = analyzeSource(delegating, 'delegating.test.ts').filter((item) => item.severity === 'violation');
assert.deepEqual(delegatingViolations, [], `delegating fixture must produce no violations: ${JSON.stringify(delegatingViolations)}`);

const noAssertionRules = new Set(analyzeSource(noAssertion, 'silent.test.ts').map((item) => item.rule));
assert.ok(noAssertionRules.has('no-assertion'), 'expected no-assertion to fire on a test with no expectations');

const workspace = await mkdtemp(join(tmpdir(), 'check-vitest-conventions-'));
try {
  await mkdir(join(workspace, 'bad-extension'));
  await writeFile(join(workspace, 'bad-extension/package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
  await writeFile(join(workspace, 'bad-extension/vitest.config.ts'), `export default { test: { isolate: false, sequence: { concurrent: true }, coverage: { provider: 'v8' } } }`);
  await mkdir(join(workspace, 'no-config'));
  await writeFile(join(workspace, 'no-config/package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
  const configRules = new Set((await configViolations(workspace)).map((item) => item.rule));
  for (const rule of ['watch-mode-script', 'missing-coverage-include', 'disabled-isolation', 'concurrent-sequence', 'missing-coverage-provider', 'missing-config']) {
    assert.ok(configRules.has(rule), `expected ${rule} to fire on the bad config fixture`);
  }

  await writeFile(join(workspace, 'bad-extension/package.json'), JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { '@vitest/coverage-v8': '^5.0.2' } }));
  await writeFile(join(workspace, 'bad-extension/vitest.config.ts'), `export default { test: { coverage: { provider: 'v8', include: ['src/*.ts'] } } }`);
  await rm(join(workspace, 'no-config'), { recursive: true });
  const cleanConfigs = (await configViolations(workspace)).filter((item) => item.severity === 'violation');
  assert.deepEqual(cleanConfigs, [], `clean config fixture must produce no violations: ${JSON.stringify(cleanConfigs)}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

process.stdout.write('check-vitest-conventions self-test: every detector fires and the clean fixture is silent.\n');
