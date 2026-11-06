// A subagent's background work belongs to the main chat, as Cursor CLI 2026.11.05 shows (parity/pstack-linux-2026-11-05,
// ledger rows BG-OWN-1 to BG-OWN-6): the subagent never hears about its own jobs, each job's notice wakes the main chat
// after the subagent's result, jobs still running when the subagent ends are aborted and reported, and a background
// subagent it started keeps running and reports to the main chat.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { contentText, makeSandbox, messages, type PiEvent, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.dispose());

interface Entry {
  type: string;
  customType?: string;
  content?: string;
  message?: { role: string; toolName?: string; toolCallId?: string; content?: { type: string; text?: string }[] };
}

/** Custom messages the main chat received, in arrival order, with their position among all events. */
const notices = (events: PiEvent[], customType: string) =>
  events.flatMap((event, index) => {
    const entry = event['entry'] as Entry | undefined;
    return event.type === 'entry_appended' && entry?.type === 'custom_message' && entry.customType === customType ? [{ index, content: entry.content ?? '' }] : [];
  });

const taskEndIndex = (events: PiEvent[]) => events.findIndex((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task');

function childTranscript(events: PiEvent[]): Entry[] {
  const [task] = toolEnds(events, 'Task');
  const path = (task?.details as { transcript?: string } | undefined)?.transcript ?? '';
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Entry);
}

/** The child's bash_background calls: Shell ID and tool call ID from its own transcript. */
function childLaunches(entries: Entry[]): { shellId: string; toolCallId: string; text: string }[] {
  return entries.flatMap((entry) => {
    const message = entry.message;
    if (entry.type !== 'message' || message?.role !== 'toolResult' || message.toolName !== 'bash_background') return [];
    const text = (message.content ?? []).map((part) => part.text ?? '').join('');
    return [{ shellId: /^Shell ID: (\d+)$/m.exec(text)?.[1] ?? '', toolCallId: message.toolCallId ?? '', text }];
  });
}

const shellNotice = (status: string, taskId: string, title: string, toolCallId: string) =>
  [
    '<system_notification>',
    'The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.',
    '',
    '<task>',
    'kind: shell',
    `status: ${status}`,
    `task_id: ${taskId}`,
    `title: ${title}`,
    `tool_call_id: ${toolCallId}`,
    '</task>',
    '</system_notification>',
    'Briefly inform the user about the task result and perform any follow-up actions (if needed).',
  ].join('\n');

test("a child's job that ends while the child runs wakes the main chat after the child's result, never the child (BG-OWN-1, BG-OWN-2)", async () => {
  const child = script([
    { tool: 'bash_background', args: { command: 'sleep 1; echo CHILD-QUICK-DONE', description: 'quick child job' } },
    { tool: 'bash', args: { command: 'sleep 4' } },
  ]);
  const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'quick job child', prompt: child } }]), ['--no-session'], 90_000);

  const [task] = toolEnds(run.events, 'Task');
  expect(task?.text).toMatch(/RESULTS:\n\[bash_background\] Background command started successfully\./);
  const entries = childTranscript(run.events);
  expect(entries.filter((entry) => entry.type === 'custom_message' && entry.customType === 'pstack/shell')).toEqual([]);
  const [launch] = childLaunches(entries);
  const received = notices(run.events, 'pstack/shell');
  expect(received.map((notice) => notice.content)).toEqual([shellNotice('success', launch?.shellId ?? '', 'quick child job', launch?.toolCallId ?? '')]);
  expect(received[0]?.index).toBeGreaterThan(taskEndIndex(run.events));
});

test('jobs still running when a child ends are aborted and reported to the main chat (BG-OWN-3, BG-OWN-5)', async () => {
  const child = script([{ tool: 'bash_background', args: { command: 'sleep 30; echo NEVER', description: 'child sleeper' } }, { text: 'LAUNCHED' }]);
  const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'bg shell child', prompt: child } }]), ['--no-session'], 90_000);

  const [launch] = childLaunches(childTranscript(run.events));
  expect(launch?.text).toMatch(/^Background command started successfully\.\nShell ID: \d+\nPID: \d+\nCommand: sleep 30; echo NEVER\nOutput will be written to (\S+)\. Don't mention Shell ID to the user\.$/);
  const path = /^Output will be written to (\S+)\./m.exec(launch?.text ?? '')?.[1] ?? '';
  expect(readFileSync(path, 'utf8')).toMatch(/status: aborted/);
  const received = notices(run.events, 'pstack/shell');
  expect(received.map((notice) => notice.content)).toEqual([shellNotice('aborted', launch?.shellId ?? '', 'child sleeper', launch?.toolCallId ?? '')]);
  expect(received[0]?.index).toBeGreaterThan(taskEndIndex(run.events));
});

test("an interactive main chat hears a background child's result before the abort notices of the jobs it left running (BG-OWN-3)", async () => {
  const rpc = startRpc(sandbox);
  try {
    const child = script([{ tool: 'bash_background', args: { command: 'sleep 30', description: 'left running' } }, { text: 'BG-CHILD-DONE' }]);
    rpc.send({ type: 'prompt', message: script([{ tool: 'Task', args: { description: 'bg child', prompt: child, run_in_background: true } }]) });
    // RPC streams a custom message as message_end with role custom, not as an appended entry.
    const isNotice = (event: PiEvent, customType: string) => event.type === 'message_end' && (event['message'] as { role?: string; customType?: string }).customType === customType;
    await rpc.waitFor((event) => isNotice(event, 'pstack/shell'), 45_000);
    const order = messages(rpc.events, 'custom')
      .filter((message) => message.customType === 'pstack/task' || message.customType === 'pstack/shell')
      .map((message) => `${message.customType === 'pstack/task' ? 'task' : 'shell'}: ${/status: (\w+)/.exec(contentText(message.content))?.[1]}`);
    expect(order).toEqual(['task: success', 'shell: aborted']);
  } finally {
    await rpc.close();
  }
});

test("an adopted background subagent ends when the main chat's process dies, as Cursor's in-process runs do (BG-OWN-4)", async () => {
  const rpc = startRpc(sandbox);
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    const child = script([{ tool: 'Task', args: { description: 'grandchild', prompt: '@@sleep 60000 LATE', run_in_background: true } }, { text: 'LAUNCHED' }]);
    rpc.send({ type: 'prompt', message: script([{ tool: 'Task', args: { description: 'bg task parent', prompt: child } }]) });
    await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task', 45_000);
    const records = join(sandbox.agentDir, 'pstack/workspaces', readdirSync(join(sandbox.agentDir, 'pstack/workspaces'))[0] ?? '', 'subagents');
    const pids = readdirSync(records)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => {
        const run = (JSON.parse(readFileSync(join(records, name), 'utf8')) as { run?: { pid: number } }).run;
        return run === undefined ? [] : [run.pid];
      });
    expect(pids).toHaveLength(1);
    const [pid = 0] = pids;
    expect(alive(pid)).toBe(true);
    const closed = new Promise((resolve) => rpc.child.once('close', resolve));
    rpc.child.kill('SIGKILL');
    await closed;
    await expect.poll(() => alive(pid), { timeout: 20_000, interval: 250 }).toBe(false);
  } finally {
    if (rpc.child.exitCode === null && rpc.child.signalCode === null) await rpc.close();
  }
});

test('a cloud agent, the top of its own tree, hears its own jobs, and the main chat does not (BG-OWN-7)', async () => {
  const git = (...args: string[]) => execFileSync('git', ['-C', sandbox.workDir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(sandbox.workDir, 'a.txt'), 'A');
  git('add', 'a.txt');
  git('commit', '-qm', 'first');
  const agent = script([
    { tool: 'bash_background', args: { command: 'sleep 1; echo CLOUD-JOB', description: 'cloud job' } },
    { tool: 'bash', args: { command: 'sleep 4' } },
  ]);
  const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'cloud worker', prompt: agent, environment: 'cloud' } }]), ['--no-session'], 90_000);

  const [task] = toolEnds(run.events, 'Task');
  expect(task?.text).toMatch(/<response>\nECHO: <system_notification>\nThe following task has finished\.[\s\S]*kind: shell\nstatus: success\n[\s\S]*title: cloud job/);
  expect(notices(run.events, 'pstack/shell')).toEqual([]);
});

test('a job the child awaited sends no notice anywhere (BG-OWN-6)', async () => {
  const child = script([
    { tool: 'bash_background', args: { command: 'sleep 1; echo AWAITED', description: 'awaited job' } },
    { tool: 'AwaitShell', args: { shell_id: '@@shell-id', block_until_ms: 10_000 } },
  ]);
  const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'awaiting child', prompt: child } }]), ['--no-session'], 90_000);

  const [task] = toolEnds(run.events, 'Task');
  expect(task?.text).toMatch(/\[AwaitShell\] Task completed in \d+ms with exit code: 0\./);
  expect(notices(run.events, 'pstack/shell').map((notice) => notice.content)).toEqual([]);
});

test("a child's background subagent outlives the child and reports to the main chat (BG-OWN-4)", async () => {
  const child = script([{ tool: 'Task', args: { description: 'grandchild', prompt: '@@sleep 2500 GRANDCHILD-DONE', run_in_background: true } }, { text: 'LAUNCHED' }]);
  const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'bg task parent', prompt: child } }]), ['--no-session'], 90_000);

  const [task] = toolEnds(run.events, 'Task');
  expect(task?.text).toMatch(/<response>\nLAUNCHED\n<\/response>/);
  const received = notices(run.events, 'pstack/task');
  expect(received).toHaveLength(1);
  expect(received[0]?.content).toMatch(/<task>\nkind: subagent\nstatus: success\ntask_id: [0-9a-f-]{36}\ntitle: @@sleep 2500 GRANDCHILD-DONE\ntool_call_id: \S+\ndetail: GRANDCHILD-DONE\n<\/task>/);
  expect(received[0]?.index).toBeGreaterThan(taskEndIndex(run.events));
});
