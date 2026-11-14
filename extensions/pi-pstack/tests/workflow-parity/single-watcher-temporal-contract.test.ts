import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { babysitSingleWatcherFamily } from './families/pr-babysit.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing fixture value');
  return value;
};
const ids = ['babysit.single.the-second-request-armed-no-second-watcher', 'babysit.single.only-one-watcher-ever-polled-the-pr'];
const observation = (id = 'w', phase = 'running') => ({ runId: 'r', id, instance: id, phase, childPid: id === 'w' ? 101 : 102, childStarted: 'process-start', before: 'process-start', after: 'process-start' });

function fixture(use: (view: RunView, save: (workers: ReturnType<typeof observation>[], spawns?: ReturnType<typeof observation>[][]) => void) => void): void {
  const sandbox = mkdtempSync(join(tmpdir(), 'single-watcher-temporal-'));
  mkdirSync(join(sandbox, 'forge', 'origin.git', 'forge'), { recursive: true });
  writeFileSync(join(sandbox, 'forge', 'origin.git', 'forge', 'state.json'), JSON.stringify({ prs: {} }));
  writeFileSync(join(sandbox, 'forge', 'origin.git', 'forge', 'actions.jsonl'), `${JSON.stringify({ kind: 'read', pr: 16, worker: 'w', run: 'r' })}\n`);
  const view = {
    sandbox,
    repo: join(sandbox, 'repo'),
    runs: [
      {
        id: 'r',
        events: [
          { kind: 'spawn', workerId: 'w', ts: '2026-11-14T10:00:00Z' },
          { kind: 'child_exit', workerId: 'w', ts: '2026-11-14T10:00:02Z' },
        ],
        workers: [{ id: 'w', dir: '/workers/w', state: { kind: 'watch', phase: 'exited', exit: { code: 0 } }, assignment: { kind: 'watch', watch: { argv: ['--pr', '16'] } } }],
      },
    ],
    parent: {
      messages: [
        { order: 0, role: 'user', text: 'babysit PR 16', at: '1999-01-01T00:00:00Z' },
        { order: 2, role: 'user', text: 'babysit PR 16', at: '1999-01-01T00:00:01Z' },
      ],
      toolCalls: [
        { order: 1, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: '/workers/w/assignment.json' } },
        { order: 3, name: 'pstack_worker', args: { action: 'inspect', runId: 'r', workerId: 'w' }, resultText: 'Worker w: exited', isError: false },
      ],
    },
  } as unknown as RunView;
  try {
    use(view, (workers, spawns = []) => writeFileSync(join(sandbox, 'single-watcher-observations.json'), JSON.stringify({ deliveries: [{ message: 'babysit PR 16', workers }], spawns })));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
const results = (view: RunView) =>
  evaluate(
    babysitSingleWatcherFamily.checks.filter((check) => ids.includes(check.id)),
    view,
  ).map((result) => result.verdict);

// babysit.md steps 3 and 6 require one active babysitter, not one worker over all history.
test('missing delivery-time liveness is inconclusive even with a running inspect', () =>
  fixture((view) => {
    required(view.parent.toolCalls[1]).resultText = 'Worker w: running';
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }));

test('a watcher live at delivery may exit before the repeat request inspects it', () =>
  fixture((view, save) => {
    save([observation()]);
    expect(results(view)).toEqual(['PASS', 'PASS']);
  }));

test.for(['exited', 'starting'])('an original watcher observed %s at delivery does not exercise reuse', (phase) =>
  fixture((view, save) => {
    save([observation('w', phase)]);
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }),
);

test('PID reuse is not proof the original child is alive', () =>
  fixture((view, save) => {
    save([{ ...observation(), after: 'different-start' }]);
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }));

test('a proven active overlap fails both checks even without the repeat premise', () =>
  fixture((view, save) => {
    save([], [[observation(), observation('duplicate')]]);
    expect(results(view)).toEqual(['FAIL', 'FAIL']);
  }));

test('malformed delivery evidence is inconclusive rather than a checker failure', () =>
  fixture((view) => {
    writeFileSync(join(view.sandbox, 'single-watcher-observations.json'), JSON.stringify({ deliveries: [null], spawns: [] }));
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }));

test('an observation for a different request cannot prove the repeat premise', () =>
  fixture((view, save) => {
    save([observation()]);
    required(view.parent.messages[1]).text = 'stop the watcher';
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }));

test('an unobserved additional watcher is ambiguous, not a proved duplicate', () =>
  fixture((view, save) => {
    const run = required(view.runs[0]);
    run.workers.push({ ...required(run.workers[0]), id: 'unknown', dir: '/workers/unknown' });
    save([observation()]);
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }));

test('a proved sequential replacement after a valid repeat request is allowed', () =>
  fixture((view, save) => {
    const run = required(view.runs[0]);
    run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement' });
    save([observation()], [[observation('w', 'exited'), observation('replacement')]]);
    expect(results(view)).toEqual(['PASS', 'PASS']);
  }));

test('a new watcher after a proved ended original is not automatically a duplicate', () =>
  fixture((view, save) => {
    const run = required(view.runs[0]);
    run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement' });
    save([observation('w', 'exited')], [[observation('w', 'exited'), observation('replacement')]]);
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }));
