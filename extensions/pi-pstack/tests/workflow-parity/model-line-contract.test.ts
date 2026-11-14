import { describe, expect, test } from 'vitest';
import { evaluate } from './lib/check.ts';
import { panelCheck, workersCheck } from './lib/checks.ts';
import type { RunView } from './lib/view.ts';

const source = { file: 'arena/SKILL.md', anchor: 'Use the `arena runners` line' };
const worker = (id: string, model: string) => ({ id, assignment: { role: 'candidate', model, workspace: { mode: 'worktree' } } });
const run = (models: string[]) => ({ models: { 'arena runners': ['claude/a:high', 'openai/b:medium'] }, parent: { models: ['openai/parent'] }, runs: [{ workers: models.map((model, i) => worker(String(i), model)) }] }) as unknown as RunView;
const panel = panelCheck('models.panel', 'configured panel', source, { role: 'candidate', line: 'arena runners', mode: 'worktree' });
const workers = workersCheck('models.workers', 'configured workers', source, { role: 'candidate', modelLine: 'arena runners', mode: 'worktree', min: 2 });
const verdicts = (models: string[]) => evaluate([panel, workers], run(models)).map((result) => result.verdict);

describe('configured model identities', () => {
  test('inline thinking levels and separate thinking levels name the same configured model', () => {
    expect(verdicts(['claude/a:high', 'openai/b:medium'])).toEqual(['PASS', 'PASS']);
    expect(verdicts(['claude/a', 'openai/b'])).toEqual(['PASS', 'PASS']);
  });
  test('another model still violates the configured line', () => {
    expect(verdicts(['claude/a:high', 'openai/other:medium'])).toEqual(['FAIL', 'FAIL']);
  });
  test('using one configured model twice does not fill a diverse panel', () => {
    expect(evaluate([panel], run(['claude/a:high', 'claude/a:high']))[0]?.verdict).toBe('FAIL');
  });
});
