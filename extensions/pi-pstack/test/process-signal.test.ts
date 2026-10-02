import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, test, vi } from 'vitest';
import { signalProcess } from '../src/process-signal.ts';
import { descendants, killSurvivors } from '../src/shell-descendants.ts';
import { ProcessGroups } from '../src/subagents/process-groups.ts';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`kill ${code}`), { code });
}

function killFailing(code: string) {
  return vi.spyOn(process, 'kill').mockImplementation(() => {
    throw errno(code);
  });
}

test.for(['ESRCH', 'EPERM'])('signalProcess treats %s as a process that is already gone', (code) => {
  const kill = killFailing(code);

  expect(() => signalProcess(-4321, 'SIGKILL')).not.toThrow();
  expect(kill).toHaveBeenCalledWith(-4321, 'SIGKILL');
});

test('signalProcess rethrows a failure that does not mean the process is gone', () => {
  killFailing('EINVAL');

  expect(() => signalProcess(4321, 'SIGKILL')).toThrow('kill EINVAL');
});

test('killSurvivors signals every survivor even when some already exited', () => {
  const kill = killFailing('ESRCH');

  killSurvivors([11, 12, 13]);

  expect(kill.mock.calls).toEqual([
    [11, 'SIGKILL'],
    [12, 'SIGKILL'],
    [13, 'SIGKILL'],
  ]);
});

test('killSurvivors surfaces a failure other than the process being gone', () => {
  killFailing('EINVAL');

  expect(() => killSurvivors([11])).toThrow('kill EINVAL');
});

test('ProcessGroups.killAll surfaces a failure other than the group being gone', () => {
  killFailing('EINVAL');
  const groups = new ProcessGroups('parent', () => {});
  groups.add({ pid: 4321 });

  expect(() => groups.killAll()).toThrow('kill EINVAL');
});

test('signalProcess delivers the requested signal to a live process', () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

  expect(() => signalProcess(4321, 'SIGTERM')).not.toThrow();
  expect(kill).toHaveBeenCalledWith(4321, 'SIGTERM');
});

test('signalProcess propagates a thrown value that is not an Error', () => {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw 'kill failed';
  });
  let thrown: unknown;
  try {
    signalProcess(4321, 'SIGKILL');
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBe('kill failed');
});

test('signalProcess propagates an Error that carries no code', () => {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw new Error('kill failed');
  });

  expect(() => signalProcess(4321, 'SIGKILL')).toThrow('kill failed');
});

test('descendants walks the process tree below a live root', async () => {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  await once(child, 'spawn');
  try {
    expect(await descendants(process.pid)).toContain(child.pid);
  } finally {
    child.kill('SIGKILL');
  }
});
