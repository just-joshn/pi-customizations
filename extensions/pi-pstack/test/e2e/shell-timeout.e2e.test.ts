// Cursor CLI 2026.11.05 moves a shell call whose timeout elapses to the background instead of killing it
// (parity/evidence/shell-timeout-probe-2026-11-07).
import { readFileSync } from 'node:fs';

import { expect, onTestFinished, test } from 'vitest';
import { makeSandbox, type PiEvent, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

const LOOP = 'for i in 1 2 3; do echo tick $i; sleep 1; done; echo FINISHED';

function sandbox(): Sandbox {
  const made = makeSandbox();
  onTestFinished(() => made.dispose());
  return made;
}

const shellNotices = (events: PiEvent[]) =>
  events
    .filter((event) => event.type === 'entry_appended')
    .map((event) => event['entry'] as { type: string; customType?: string; content: string })
    .filter((entry) => entry.type === 'custom_message' && entry.customType === 'pstack/shell')
    .map((entry) => entry.content);

const MOVED =
  /^The command did not complete in 1500ms and was sent to the background\.\nShell ID: (\d+)\nPID: (\d+)\nThe output is being written to (\S+\/terminals\/\d+\.txt)\. Don't mention Shell ID to the user\.\n\nOutput collected before backgrounding:\n\n```\ntick 1\ntick 2\n\n```$/;

test('a bash call whose timeout elapses moves to the background, keeps running, and notifies when it finishes', async () => {
  const run = await runJson(sandbox(), script([{ tool: 'bash', args: { command: LOOP, timeout: 1.5 } }]), ['--no-session']);

  const [moved] = toolEnds(run.events, 'bash');
  expect(moved?.isError).toBe(false);
  expect(moved?.text).toMatch(MOVED);
  const [, shellId, pid, path = ''] = MOVED.exec(moved?.text ?? '') ?? [];
  const toolCallId = run.events.find((event) => event.type === 'tool_execution_end')?.['toolCallId'] as string;
  expect(readFileSync(path, 'utf8')).toMatch(
    new RegExp(
      `^---\\npid: ${pid}\\ncwd: ".+"\\ncommand: ${JSON.stringify(LOOP).replaceAll('$', '\\$')}\\ntitle: .+\\nstatus: succeeded\\nstarted_at: \\S+\\nrunning_for_ms: \\d+ *\\n---\\ntick 1\\ntick 2\\ntick 3\\nFINISHED\\n\\n---\\nexit_code: 0\\n`,
    ),
  );
  expect(shellNotices(run.events)).toEqual([
    [
      '<system_notification>',
      'The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.',
      '',
      '<task>',
      'kind: shell',
      'status: success',
      `task_id: ${shellId}`,
      `title: ${LOOP}`,
      `tool_call_id: ${toolCallId}`,
      '</task>',
      '</system_notification>',
      'Briefly inform the user about the task result and perform any follow-up actions (if needed).',
    ].join('\n'),
  ]);
});

test('AwaitShell waits on a moved command, which then sends no notification and leaves the shell state as it was', async () => {
  const box = sandbox();
  const run = await runJson(
    box,
    script([
      { tool: 'bash', args: { command: 'cd /usr && export PSTACK_T=1 && echo START && sleep 2 && echo LATE', timeout: 1 } },
      { tool: 'AwaitShell', args: { shell_id: '@@shell-id', block_until_ms: 20_000 } },
      { tool: 'bash', args: { command: `pwd; echo "t=\${PSTACK_T-unset}"` } },
    ]),
    ['--no-session'],
  );

  expect(toolEnds(run.events, 'AwaitShell').map((end) => [end.isError, end.text])).toEqual([[false, expect.stringMatching(/^Task completed in \d+ms with exit code: 0\.\noutput_file_path: \S+\noutput_length: \d+$/)]]);
  expect(toolEnds(run.events, 'bash')[1]?.text).toBe(`${box.workDir}\nt=unset\n`);
  expect(shellNotices(run.events)).toEqual([]);
});

test('closing the session stops a moved command', async () => {
  const rpc = startRpc(sandbox(), ['--no-session']);
  onTestFinished(() => rpc.close());
  rpc.send({ type: 'prompt', message: script([{ tool: 'bash', args: { command: 'echo START; sleep 300', timeout: 1 } }]) });
  const moved = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'bash');
  const { content, details } = moved['result'] as { content: { text: string }[]; details: { fullOutputPath: string } };
  const pid = Number(/^PID: (\d+)$/m.exec(content[0]?.text ?? '')?.[1]);
  const outputPath = details.fullOutputPath;
  await rpc.waitFor((event) => event.type === 'agent_settled');

  await rpc.close();

  await expect.poll(() => readFileSync(outputPath, 'utf8')).toMatch(/status: aborted {2}\n[\s\S]*---\nSTART\n\n---\nexit_code: 143\n/);
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
