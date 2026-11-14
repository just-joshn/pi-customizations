import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { processStartTime } from '../../src/run-files.ts';
import { babysitSingleWatcherFamily } from './families/pr-babysit.ts';
import type { WatcherObservation } from './families/pr-watcher-observation.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing fixture value');
  return value;
};
const ids = ['babysit.single.the-second-request-armed-no-second-watcher', 'babysit.single.only-one-watcher-ever-polled-the-pr'];
const observation = (id = 'w', phase = 'running') => ({ runId: 'r', id, instance: id, phase, childPid: id === 'w' ? 101 : 102, childStarted: 'process-start', before: 'process-start', after: 'process-start' });
const ended = (id = 'w'): WatcherObservation => ({ ...observation(id, 'exited'), before: null, after: null, absentBefore: true, absentAfter: true });

function fixture(use: (view: RunView, save: (workers: WatcherObservation[], spawns?: WatcherObservation[][]) => void) => void): void {
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

test.for(['exited', 'aborted', 'starting'])('matching identities of simultaneous real children fail overlap despite an old %s phase', async (phase) => {
  const children = Array.from({ length: 2 }, () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }));
  const exits = children.map((child) => once(child, 'exit'));
  try {
    await Promise.all(children.map((child) => once(child, 'spawn')));
    const samples = children.map((child, index) => {
      const pid = required(child.pid);
      const started = required(processStartTime(pid));
      return { ...observation(index === 0 ? 'w' : 'replacement'), childPid: pid, childStarted: started, before: started, after: started };
    });
    const delivery = { ...required(samples[0]) };
    required(samples[0]).phase = phase;
    const group = samples.map((worker) => ({ ...worker, before: required(processStartTime(worker.childPid)) }));
    for (const worker of group) worker.after = required(processStartTime(worker.childPid));
    fixture((view, save) => {
      const run = required(view.runs[0]);
      run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement' });
      save([delivery], [group]);
      expect(results(view)).toEqual(['FAIL', 'FAIL']);
    });
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.allSettled(exits);
  }
});

test('a terminal phase with unreadable process starts cannot prove a sequential replacement', () =>
  fixture((view, save) => {
    const run = required(view.runs[0]);
    run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement' });
    save([observation()], [[{ ...observation('w', 'exited'), before: null, after: null }, observation('replacement')]]);
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }));

test.for([
  { before: null, after: null, absentBefore: true, absentAfter: false },
  { before: 'process-start', after: null, absentBefore: false, absentAfter: true },
])('partial or contradictory termination samples cannot prove non-overlap %j', (samples) =>
  fixture((view, save) => {
    const run = required(view.runs[0]);
    run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement' });
    save([observation()], [[{ ...observation('w', 'exited'), ...samples }, observation('replacement')]]);
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }),
);

test('matching PID reuse samples prove the old process identity ended', () =>
  fixture((view, save) => {
    const run = required(view.runs[0]);
    run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement' });
    save([observation()], [[{ ...observation('w', 'exited'), before: 'new-process-start', after: 'new-process-start' }, observation('replacement')]]);
    expect(results(view)).toEqual(['PASS', 'PASS']);
  }));

test('a reaped owned child with ESRCH supports a sequential replacement', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const exited = once(child, 'exit');
  try {
    await once(child, 'spawn');
    const pid = required(child.pid);
    const started = required(processStartTime(pid));
    const delivery = { ...observation(), childPid: pid, childStarted: started, before: started, after: started };
    child.kill('SIGTERM');
    await exited;
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    const before = processStartTime(pid) ?? null;
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    const after = processStartTime(pid) ?? null;
    fixture((view, save) => {
      const run = required(view.runs[0]);
      run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement' });
      save([delivery], [[{ ...ended(), childPid: pid, childStarted: started, before, after }, observation('replacement')]]);
      expect(results(view)).toEqual(['PASS', 'PASS']);
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  }
});

test('late ESRCH observations cannot prove end-before-start when actual overlap is withheld', async () => {
  const children: ReturnType<typeof spawn>[] = [];
  const exits: Promise<unknown>[] = [];
  const start = async (id: string) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    children.push(child);
    exits.push(once(child, 'exit'));
    await once(child, 'spawn');
    const pid = required(child.pid);
    const started = required(processStartTime(pid));
    return { ...observation(id), childPid: pid, childStarted: started, before: started, after: started };
  };
  try {
    const original = await start('w');
    const delivery = { ...original };
    expect(processStartTime(original.childPid)).toBe(original.childStarted);
    const replacement = await start('replacement');
    const truth = [original, replacement].map((worker) => ({ ...worker, before: processStartTime(worker.childPid) }));
    for (const worker of truth) {
      expect(worker.before).toBe(worker.childStarted);
      expect(processStartTime(worker.childPid)).toBe(worker.childStarted);
    }
    required(children[0]).kill('SIGTERM');
    await exits[0];
    const sample = () => {
      const started = processStartTime(original.childPid) ?? null;
      expect(() => process.kill(original.childPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
      return started;
    };
    const late = { ...original, phase: 'exited', before: sample(), after: sample(), absentBefore: true, absentAfter: true };
    expect(late.before).toBeNull();
    expect(late.after).toBeNull();
    fixture((view, save) => {
      const run = required(view.runs[0]);
      run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement', state: { kind: 'watch', phase: 'running' } });
      required(view.parent.toolCalls[1]).resultText = 'Worker w: running';
      view.parent.toolCalls.push({ order: 4, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: '/workers/replacement/assignment.json' }, resultText: 'Worker replacement: running', isError: false });
      save([delivery], [[late, { ...replacement, before: required(processStartTime(replacement.childPid)), after: required(processStartTime(replacement.childPid)) }]]);
      expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
    });
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.allSettled(exits);
  }
});

test('a proved sequential replacement after a valid repeat request is allowed', () =>
  fixture((view, save) => {
    const run = required(view.runs[0]);
    run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement' });
    save([observation()], [[ended(), observation('replacement')]]);
    expect(results(view)).toEqual(['PASS', 'PASS']);
  }));

test('a new watcher after a proved ended original is not automatically a duplicate', () =>
  fixture((view, save) => {
    const run = required(view.runs[0]);
    run.workers.push({ ...required(run.workers[0]), id: 'replacement', dir: '/workers/replacement' });
    save([ended()], [[ended(), observation('replacement')]]);
    expect(results(view)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  }));
