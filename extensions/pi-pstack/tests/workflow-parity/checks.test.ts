// The shared checks accept what the skills and the tool descriptions allow, and still fail what they forbid.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import { evaluate } from './lib/check.ts';
import { fileReferencesResolve, noToolErrors, settledAndCollected } from './lib/checks.ts';
import type { RunView } from './lib/view.ts';

const call = (order: number, args: Record<string, unknown>, resultText: string) => ({ order, name: 'pstack_worker', args, resultText, isError: false });
const wake = (order: number) => ({ order, role: 'custom', text: 'woken', customType: 'pstack-worker', details: { workerId: 'w' } });

function view(toolCalls: ReturnType<typeof call>[], messages: ReturnType<typeof wake>[]): RunView {
  const worker = { id: 'w', assignment: { kind: 'pi', role: 'general' }, state: { settles: [{ phase: 'idle' }] } };
  return { runs: [{ workers: [worker] }], parent: { messages, toolCalls } } as unknown as RunView;
}

const verdict = (run: RunView) => evaluate([settledAndCollected('t.collected', { file: 'how/SKILL.md', anchor: '## 4. Present' })], run)[0];
const collect = (order: number) => call(order, { action: 'collect', workerId: 'w' }, 'Worker w settled (idle).');
const inspect = (order: number, phase: string) => call(order, { action: 'inspect', workerId: 'w' }, `Worker w: ${phase}`);

describe('collect needs a wake or an inspect that shows the worker settled', () => {
  test('a collect after the wake is allowed', () => {
    expect(verdict(view([collect(5)], [wake(4)]))?.verdict).toBe('PASS');
  });
  test('a collect after an inspect showed the worker idle is allowed even though the wake arrives later', () => {
    expect(verdict(view([inspect(3, 'idle'), collect(4)], [wake(6)]))?.verdict).toBe('PASS');
  });
  test('a collect while the last inspect said running is refused', () => {
    expect(verdict(view([inspect(3, 'running'), collect(4)], [wake(6)]))?.verdict).toBe('FAIL');
  });
  test('a collect with no inspect and no wake yet is refused', () => {
    expect(verdict(view([collect(4)], [wake(6)]))?.verdict).toBe('FAIL');
  });
  test('a worker that never woke the parent is refused', () => {
    expect(verdict(view([inspect(3, 'idle'), collect(4)], []))?.verdict).toBe('FAIL');
  });
});

describe('file references', () => {
  const repo = mkdtempSync(join(tmpdir(), 'wf-refs-'));
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'cart.js'), 'a\nb\nc\n');
  writeFileSync(join(repo, 'src', 'money.js'), 'a\n');
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  const check = (text: string, min = 2) => evaluate([fileReferencesResolve('t.refs', { file: 'how/references/explainer-prompt.md', anchor: 'Reference specific files and functions' }, { min, from: () => text })], { repo } as unknown as RunView)[0]?.verdict;

  test('files named by path or bare name count, with or without a line', () => {
    expect(check('See `src/cart.js` and money.js:1, built on Node.js.')).toBe('PASS');
  });
  test('a path that is not in the repository fails', () => {
    expect(check('See src/cart.js and src/nope.js.')).toBe('FAIL');
  });
  test('a line past the end of the file fails', () => {
    expect(check('See src/cart.js:2 and src/money.js:9.')).toBe('FAIL');
  });
  test('too few files fails', () => {
    expect(check('Only src/cart.js here.')).toBe('FAIL');
  });
});

describe('tool errors', () => {
  const run = (name: string, resultText: string) => evaluate([noToolErrors('t.errors', { file: 'how/SKILL.md', anchor: '## 4. Present' })], { parent: { toolCalls: [{ order: 1, name, args: {}, resultText, isError: true }] } } as unknown as RunView)[0]?.verdict;

  test('a bash probe that exited non-zero is not a failed tool', () => {
    expect(run('bash', '.\n..\n.git\n\n\nCommand exited with code 1')).toBe('PASS');
  });
  test('a bash command that timed out is a failed tool', () => {
    expect(run('bash', 'partial\n\nCommand timed out after 30 seconds')).toBe('FAIL');
  });
  test('a refused pstack_worker call is a failed tool even when its text mentions an exit code', () => {
    expect(run('pstack_worker', 'Run x has no run.json\n\nCommand exited with code 1')).toBe('FAIL');
  });
});
