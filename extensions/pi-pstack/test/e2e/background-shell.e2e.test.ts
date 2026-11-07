// bash_background and AwaitShell through the real Pi CLI, against the texts Cursor CLI 2026.10.22 returns and sends.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

const { factoryCases } = JSON.parse(readFileSync(new URL('../fixtures/cursor-shell-monitor.json', import.meta.url), 'utf8')) as {
  factoryCases: { id: string; name: string; pattern: string; warning: boolean }[];
};

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

  test('a watched pattern counts every occurrence in output without line breaks', async () => {
    const run = await runJson(sandbox, script([{ tool: 'bash_background', args: { command: 'printf "HIT HIT HIT"', notify_on_output: { pattern: 'HIT', reason: 'matches' } } }]), ['--no-session']);
    expect(run.exitCode).toBe(0);
    const notices = shellNotices(run.events);
    expect(notices).toHaveLength(3);
    expect(notices[0]).toContain('This is occurrence number 1. Matched text: HIT.');
    expect(notices[1]).toContain('Shell output matched /HIT/ 2 more times since the previous notification.');
    expect(notices[2]).toContain('kind: shell\nstatus: success');
  });

  test('output monitoring stops at the reference limit and tells the session to read the file', async () => {
    const run = await runJson(sandbox, script([{ tool: 'bash_background', args: { command: `printf '%s' '${'HIT '.repeat(150)}'`, notify_on_output: { pattern: 'HIT', reason: 'matches' } } }]), ['--no-session']);
    expect(run.exitCode).toBe(0);
    const notices = shellNotices(run.events);
    expect(notices).toHaveLength(4);
    expect(notices[1]).toContain('Shell output matched /HIT/ 99 more times since the previous notification.');
    expect(notices[2]).toContain('title: Notification limit reached (100)');
    expect(notices[2]).toContain('No further notifications will be sent for this pattern.');
    expect(notices[2]).toContain('output_path: ');
  });

  test.for(factoryCases)('$id the $name watch preserves command execution', async ({ pattern, warning }) => {
    const run = await runJson(sandbox, script([{ tool: 'bash_background', args: { command: 'printf WATCH-SKIP', notify_on_output: { pattern, reason: 'invalid watch' } } }]), ['--no-session']);
    const [launch] = toolEnds(run.events, 'bash_background');
    expect(launch?.isError).toBe(false);
    const { path } = launchFields(launch?.text);
    expect(readFileSync(path, 'utf8')).toContain('WATCH-SKIP');
    expect(shellNotices(run.events)).toHaveLength(1);
    expect(shellNotices(run.events)[0]).toContain('has finished.');
    if (warning) expect(run.stderr).toContain('Invalid shell output notification pattern');
    else expect(run.stderr).not.toContain('Invalid shell output notification pattern');
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

  test('AwaitShell that sees a background command already ended skips its notification and the extra turn', async () => {
    const run = await runJson(
      sandbox,
      script([
        { tool: 'bash_background', args: { command: 'sleep 1; echo BG-DONE' } },
        { tool: 'AwaitShell', args: { block_until_ms: 2_500 } },
        { tool: 'AwaitShell', args: { shell_id: '@@shell-id', block_until_ms: 1_000 } },
      ]),
      ['--no-session'],
    );
    expect(toolEnds(run.events, 'AwaitShell').map((end) => end.text)).toEqual(['Slept for 2.5s.', expect.stringMatching(/^Task completed in \d+ms with exit code: 0\./)]);
    expect(shellNotices(run.events)).toEqual([]);
    expect(run.events.filter((event) => event.type === 'agent_start')).toHaveLength(1);
  });

  test('a background command that ends unawaited during the turn notifies once the turn ends', async () => {
    const run = await runJson(
      sandbox,
      script([
        { tool: 'bash_background', args: { command: 'echo BG-DONE', description: 'quick probe' } },
        { tool: 'AwaitShell', args: { block_until_ms: 1_000 } },
      ]),
      ['--no-session'],
    );
    expect(shellNotices(run.events)).toEqual([expect.stringContaining('status: success\ntask_id: ')]);
    expect(assistantTexts(run.events).at(-1)?.startsWith('ECHO: <system_notification>\nThe following task has finished.')).toBe(true);
  });

  test("AwaitShell refuses to wait for subagents and to check no shell, with Cursor desktop's errors", async () => {
    const run = await runJson(
      sandbox,
      script([
        { tool: 'AwaitShell', args: { block_until_ms: 3_000, waiting_for_subagent: true } },
        { tool: 'AwaitShell', args: { block_until_ms: 0 } },
      ]),
      ['--no-session'],
    );
    expect(toolEnds(run.events, 'AwaitShell').map((end) => [end.isError, end.text])).toEqual([
      [true, 'You should NOT wait for subagents to complete. End your turn instead; completions are queued, or do parallel work.'],
      [true, 'Invalid arguments:\nshell_id: Required when block_until_ms is 0. Without shell_id there is nothing to check: pass the shell_id to check, or a nonzero block_until_ms to sleep.'],
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

  test('a command that ends unawaited during the turn wakes the agent once the turn ends', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({
        type: 'prompt',
        message: script([
          { tool: 'bash_background', args: { command: 'echo BG-DONE', description: 'quick probe' } },
          { tool: 'AwaitShell', args: { block_until_ms: 1_000 } },
        ]),
      });
      const woken = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant' && JSON.stringify(event['message']).includes('title: quick probe'), 10_000);
      expect(JSON.stringify(woken['message'])).toContain('ECHO: <system_notification>');
    } finally {
      await rpc.close();
    }
  });

  test('a watched match wakes the session before the producer writes a newline or exits', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    const gate = join(sandbox.workDir, 'release');
    const producer = `const fs = require('node:fs'); const watcher = fs.watch(${JSON.stringify(sandbox.workDir)}, (_, name) => { if (name === 'release') { watcher.close(); } }); fs.writeSync(1, 'READY');`;
    try {
      rpc.send({
        type: 'prompt',
        message: script([
          { tool: 'bash_background', args: { command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(producer)}`, description: 'streaming match', notify_on_output: { pattern: 'READY', reason: 'producer ready' } } },
        ]),
      });
      await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'bash_background');
      const progress = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { customType?: string }).customType === 'pstack/shell', 5_000);
      expect(JSON.stringify(progress['message'])).toContain('Matched text: READY.');
      expect(JSON.stringify(progress['message'])).toContain('has notified.');
      writeFileSync(gate, 'release');
      await rpc.waitFor((event) => event.type === 'message_end' && JSON.stringify(event['message']).includes('title: streaming match'));
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
