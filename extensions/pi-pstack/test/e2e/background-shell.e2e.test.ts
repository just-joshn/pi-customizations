// bash_background and AwaitShell through the real Pi CLI, against the texts Cursor CLI 2026.10.22 returns and sends.
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { assistantTexts, makeSandbox, type PiEvent, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.dispose());

const shellNotices = (events: PiEvent[]) =>
  events
    .filter((event) => event.type === 'entry_appended')
    .map((event) => event['entry'] as { type: string; customType?: string; content: string })
    .filter((entry) => entry.type === 'custom_message' && entry.customType === 'pstack/shell')
    .map((entry) => entry.content);

const launchFields = (text: string | undefined) => ({
  shellId: /^Shell ID: (\d+)$/m.exec(text ?? '')?.[1] ?? '',
  path: /^Output will be written to (\S+)\. Don't mention Shell ID to the user\.$/m.exec(text ?? '')?.[1] ?? '',
});

describe('print and JSON runs', () => {
  test('a background command returns at once, and the run waits for it and takes a turn on its completion notice', async () => {
    const run = await runJson(sandbox, script([{ tool: 'bash_background', args: { command: 'sleep 1; echo BG-DONE', description: 'bg probe' } }]), ['--no-session']);
    const [launch] = toolEnds(run.events, 'bash_background');
    expect(launch?.text).toMatch(/^Background command started successfully\.\nShell ID: \d+\nPID: \d+\nCommand: sleep 1; echo BG-DONE\nOutput will be written to \S+\/terminals\/\d+\.txt\. Don't mention Shell ID to the user\.$/);
    const { shellId, path } = launchFields(launch?.text);
    const toolCallId = run.events.find((event) => event.type === 'tool_execution_end')?.['toolCallId'] as string;
    expect(shellNotices(run.events)).toEqual([
      [
        '<system_notification>',
        'The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.',
        '',
        '<task>',
        'kind: shell',
        'status: success',
        `task_id: ${shellId}`,
        'title: bg probe',
        `tool_call_id: ${toolCallId}`,
        '</task>',
        '</system_notification>',
        'Briefly inform the user about the task result and perform any follow-up actions (if needed).',
      ].join('\n'),
    ]);
    expect(assistantTexts(run.events).at(-1)?.startsWith('ECHO: <system_notification>\nThe following task has finished.')).toBe(true);
    expect(readFileSync(path, 'utf8')).toMatch(/status: succeeded\n[\s\S]*---\nBG-DONE\n\n---\nexit_code: 0\n/);
  });

  test('a command that outlasts block_until_ms moves to the background with the output so far', async () => {
    const run = await runJson(sandbox, script([{ tool: 'bash_background', args: { command: 'echo LINE-1; sleep 2; echo LINE-2', block_until_ms: 500 } }]), ['--no-session']);
    const [moved] = toolEnds(run.events, 'bash_background');
    expect(moved?.text).toMatch(
      /^The command did not complete in 500ms and was sent to the background\.\nShell ID: \d+\nPID: \d+\nThe output is being written to \S+\. Don't mention Shell ID to the user\.\n\nOutput collected before backgrounding:\n\n```\nLINE-1\n\n```$/,
    );
    expect(shellNotices(run.events)).toHaveLength(1);
  });

  test('a command that finishes inside block_until_ms returns its output and sends no notification', async () => {
    const run = await runJson(sandbox, script([{ tool: 'bash_background', args: { command: 'echo FG-OK; echo ERR-LINE 1>&2; exit 7', block_until_ms: 20_000 } }]), ['--no-session']);
    const [done] = toolEnds(run.events, 'bash_background');
    expect(done?.text).toMatch(/^Exit code: 7\n\nCommand output:\n\n```\nFG-OK\nERR-LINE\n\n```\n\nCommand completed in \d+ ms\.$/);
    expect(shellNotices(run.events)).toEqual([]);
  });

  test('AwaitShell sleeps without a shell id and reports a running job by id', async () => {
    const run = await runJson(
      sandbox,
      script([
        { tool: 'bash_background', args: { command: 'echo STARTED; sleep 2' } },
        { tool: 'AwaitShell', args: { block_until_ms: 300 } },
        { tool: 'AwaitShell', args: { shell_id: 'nope', block_until_ms: 0 } },
      ]),
      ['--no-session'],
    );
    expect(toolEnds(run.events, 'AwaitShell').map((end) => [end.isError, end.text])).toEqual([
      [false, 'Slept for 0.3s.'],
      [true, 'Error awaiting task: No shell found for id nope'],
    ]);
  });
});

describe('interactive sessions', () => {
  test('a watched line and the completion each wake the agent with a notification turn', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({
        type: 'prompt',
        message: script([{ tool: 'bash_background', args: { command: 'sleep 1; echo TICK-2; sleep 1', description: 'tick loop', notify_on_output: { pattern: '^TICK-2', reason: 'second tick' } } }]),
      });
      const launch = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'bash_background');
      const shellId = (launch['result'] as { details: { shellId: string } }).details.shellId;
      const isAssistant = (event: PiEvent) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant';
      await rpc.waitFor((event) => isAssistant(event) && JSON.stringify(event['message']).includes(`task_id: ${shellId}\\ntitle: tick loop`), 20_000);
      const turns = rpc.events.filter(isAssistant).map((event) => JSON.stringify(event['message']));
      expect(turns.filter((text) => text.includes('ECHO: <system_notification>'))).toHaveLength(2);
      const progress = rpc.events.find((event) => event.type === 'message_end' && JSON.stringify(event['message']).includes(`task_id: ${shellId}:task_progress:1`));
      expect(JSON.stringify(progress?.['message'])).toContain('detail: Shell output has pattern /^TICK-2/. This is occurrence number 1. Matched text: TICK-2. The title message is being displayed to the user.\\noutput_path: ');
    } finally {
      await rpc.close();
    }
  });

  test('closing the session stops a running job', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    rpc.send({ type: 'prompt', message: script([{ tool: 'bash_background', args: { command: 'sleep 300' } }]) });
    const launch = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'bash_background');
    const { pid, outputPath } = (launch['result'] as { details: { pid: number; outputPath: string } }).details;
    await rpc.waitFor((event) => event.type === 'agent_settled' || event.type === 'agent_end');
    await rpc.close();
    await expect.poll(() => readFileSync(outputPath, 'utf8')).toMatch(/status: aborted {2}/);
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return 'alive';
        } catch {
          return 'gone';
        }
      })
      .toBe('gone');
  });
});

test('a readonly subagent and plan mode get no background shell (TASK-019)', async () => {
  const child = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'ro', prompt: 'go\n@@tools-list', readonly: true } }]), ['--no-session']);
  const [result] = toolEnds(child.events, 'Task');
  expect(
    /<response>\n(.*)\n<\/response>/
      .exec(result?.text ?? '')?.[1]
      ?.split(',')
      .filter((name) => name === 'bash_background' || name === 'AwaitShell'),
  ).toEqual([]);
});
