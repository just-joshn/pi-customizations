import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { readTodoLedger, replaceTodoLedger } from '../../src/todo.ts';
import { todoChecks } from './lib/checks.ts';
import { PKG } from './lib/driver.ts';
import { parseTodoSteps, type RunView } from './lib/view.ts';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'todo-checker-'));
  directories.push(dir);
  const result = spawnSync(process.execPath, [join(PKG, 'scripts/start-run.mjs'), '--playbook', 'feature', '--title', 'Checker contract', '--run-id', 'contract'], { cwd: dir, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return readFileSync(join(dir, '.pi/pstack/runs/contract/TODO.md'), 'utf8');
}
function check(text: string, suffix: string) {
  const view = { runs: [{ id: 'contract', todoText: text, steps: parseTodoSteps(text), workers: [] }], todoHistory: {}, parent: { toolCalls: [] } } as unknown as RunView;
  const selected = todoChecks({ playbook: 'feature' }).find((entry) => entry.id.endsWith(suffix));
  if (selected === undefined) throw new Error(`Missing checker ${suffix}`);
  return selected.run(view);
}

test('checker compares pinned vendor bytes without checkbox, whitespace, or order normalization', () => {
  const text = fixture();
  expect(check(text, 'steps-verbatim-in-order')).toMatchObject({ ok: true });
  for (const changed of [
    text.replace('1. `how`', '- [ ] 1. `how`'),
    text.replace('1. `how`', '1.  `how`'),
    text.replace('1. `how` over the affected subsystem.', '1. `how` over the affected subsystem. '),
    text.replace('1. `how` over the affected subsystem.\n2. `architect` for parallel design exploration.', '2. `architect` for parallel design exploration.\n1. `how` over the affected subsystem.'),
    text.replace('1. `how` over the affected subsystem.\n', ''),
  ])
    expect(check(changed, 'steps-verbatim-in-order')).toMatchObject({ ok: false });
});

test('ledger changes leave source checks green but blocked and running are not resolved', () => {
  const text = fixture();
  const ledger = readTodoLedger(text);
  for (const entry of ledger) {
    entry.status = 'skipped';
    entry.skip = 'skip: outside this fixture';
  }
  expect(check(replaceTodoLedger(text, ledger), 'every-step-resolved')).toMatchObject({ ok: true });
  for (const status of ['blocked', 'running', 'pending'] as const) {
    for (const entry of ledger.filter((step) => step.n === 1)) {
      entry.status = status;
      entry.skip = null;
    }
    const changed = replaceTodoLedger(text, ledger);
    expect(check(changed, 'steps-verbatim-in-order')).toMatchObject({ ok: true });
    expect(check(changed, 'ledger-schema')).toMatchObject({ ok: true });
    expect(check(changed, 'every-step-resolved')).toMatchObject({ ok: false });
  }
});

test.for(['requiredProof', 'source', 'status', 'n', 'skip'])('checker rejects missing ledger %s instead of accepting inline completion', (key) => {
  const text = fixture();
  const ledger = readTodoLedger(text);
  const valid = JSON.stringify(ledger, null, 2);
  const malformed = JSON.parse(valid) as Record<string, unknown>[];
  for (const entry of malformed.filter((step) => step['n'] === 1)) delete entry[key];
  const changed = text.replace(valid, JSON.stringify(malformed, null, 2));
  expect(check(changed, 'ledger-schema')).toMatchObject({ ok: false });
});

test('checker requires the immutable source first and the ledger before task-specific work', () => {
  const text = fixture();
  const ledgerStart = text.indexOf('## Status ledger');
  const taskStart = text.indexOf('## Task-specific work');
  for (const changed of [text.replace('## Original playbook steps', '## Other work\n\n## Original playbook steps'), `${text.slice(ledgerStart, taskStart)}${text.slice(0, ledgerStart)}${text.slice(taskStart)}`])
    expect(check(changed, 'ledger-schema')).toMatchObject({ ok: false });
});

test('checker rejects a skipped step without a retained one-line reason', () => {
  const text = fixture();
  const ledger = readTodoLedger(text);
  const valid = JSON.stringify(ledger, null, 2);
  for (const entry of ledger.filter((step) => step.n === 1)) {
    entry.status = 'skipped';
    entry.skip = null;
  }
  const changed = text.replace(valid, JSON.stringify(ledger, null, 2));
  expect(check(changed, 'skips-explained')).toMatchObject({ ok: false });
});
