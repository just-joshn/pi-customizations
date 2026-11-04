import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { contentText, makeSandbox, type PiEvent, type RpcSession, script, startRpc, toolEnds } from './harness.ts';

/** Answers each select or confirm dialog with the next scripted value, in order. */
function answerDialogs(rpc: RpcSession, answers: (string | boolean)[]): PiEvent[] {
  const seen: PiEvent[] = [];
  rpc.child.stdout?.on('data', () => {
    for (const event of rpc.events.filter((candidate) => candidate.type === 'extension_ui_request' && (candidate['method'] === 'select' || candidate['method'] === 'confirm') && !seen.includes(candidate))) {
      seen.push(event);
      const answer = answers.shift();
      rpc.send({ type: 'extension_ui_response', id: event['id'], ...(typeof answer === 'boolean' ? { confirmed: answer } : { value: answer }) });
    }
  });
  return seen;
}

const settledAfter = (rpc: RpcSession, mark: number) => rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);

// Cursor's plan mode ends in a plan file the user reviews, a choice to build it, and markdown-only edits meanwhile.
test('plan mode saves a Cursor-shaped plan, asks whether to build it, and builds it on yes', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  const dialogs = answerDialogs(rpc, ['No, propose changes', 'Yes, build locally']);
  const notify = (prefix: string) => rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith(prefix));

  rpc.send({ type: 'prompt', message: '/plan' });
  await notify('Plan mode on');

  writeFileSync(join(sandbox.workDir, 'code.ts'), 'export {};\n');
  const mark = rpc.events.length;
  const steps = [
    { tool: 'CreatePlan', args: { name: 'Ship it', overview: 'Prove the file.', plan: '# Ship it\n\n- prove the file exists', todos: [{ id: 'prove', content: 'Prove the file exists' }] } },
    { tool: 'write', args: { path: 'notes.md', content: '# notes\n' } },
    { tool: 'edit', args: { path: 'code.ts', edits: [{ oldText: 'export {};', newText: 'export const x = 1;' }] } },
  ];
  rpc.send({ type: 'prompt', message: script(steps) });
  await settledAfter(rpc, mark);
  const ends = rpc.events.slice(mark).filter((event) => event.type === 'tool_execution_end');
  const planFile = String((ends.find((event) => event['toolName'] === 'CreatePlan')?.['result'] as { details?: { planFile?: string } } | undefined)?.details?.planFile ?? '');
  expect(planFile).toMatch(/\/pstack\/plans\/Ship it-[0-9a-f]{8}\.plan\.md$/);
  expect(readFileSync(planFile, 'utf8')).toMatch(/^<!-- [0-9a-f-]+ -->\n---\ntodos:\n {2}- id: "prove"\n {4}content: "Prove the file exists"\n {4}status: pending\nisProject: false\n---\n# Ship it\n\n- prove the file exists$/);
  expect(ends.map((event) => [event['toolName'], event['isError']])).toEqual([
    ['CreatePlan', false],
    ['write', false],
    ['edit', true],
  ]);
  expect([existsSync(join(sandbox.workDir, 'notes.md')), readFileSync(join(sandbox.workDir, 'code.ts'), 'utf8')]).toEqual([true, 'export {};\n']);

  await rpc.waitFor(() => dialogs.length === 1);
  expect(dialogs[0]?.['options']).toEqual(['Yes, build locally', 'No, propose changes']);

  const again = rpc.events.length;
  rpc.send({ type: 'prompt', message: script([{ tool: 'edit', args: { path: planFile, edits: [{ oldText: '- prove the file exists', newText: '- prove the file exists twice' }] } }]) });
  await settledAfter(rpc, again);
  rpc.send({ type: 'prompt', message: script([{ tool: 'CreatePlan', args: { plan: '# Ship it\n\n- prove the file exists twice' } }]) });
  const build = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'user' && contentText((event['message'] as { content: string }).content).startsWith('Build the plan saved at'));
  expect(contentText((build['message'] as { content: string }).content)).toBe([`Build the plan saved at ${planFile}. Follow it.`, '', '# Ship it', '', '- prove the file exists twice'].join('\n'));
  const footer = rpc.events.filter((event) => event.type === 'extension_ui_request' && event['method'] === 'setStatus' && event['statusKey'] === 'pstack-plan').at(-1);
  expect(footer?.['statusText']).toBeUndefined();
});

test('CreatePlan retains todo dependencies and project phases in its saved file', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  answerDialogs(rpc, ['No, propose changes']);
  rpc.send({ id: 'plan', type: 'prompt', message: '/plan' });
  await rpc.waitFor((event) => event['id'] === 'plan');
  const mark = rpc.events.length;
  rpc.send({
    type: 'prompt',
    message: script([
      {
        tool: 'CreatePlan',
        args: {
          plan: '# Project plan',
          is_project: true,
          todos: [{ id: 'build', content: 'Build', dependencies: ['design'] }],
          phases: [
            { name: 'Design', todos: [{ id: 'design', content: 'Choose the design' }] },
            { name: 'Build', todos: [{ id: 'implement', content: 'Implement', dependencies: ['design'] }] },
          ],
        },
      },
    ]),
  });
  await settledAfter(rpc, mark);
  const end = rpc.events.slice(mark).find((event) => event.type === 'tool_execution_end' && event['toolName'] === 'CreatePlan');
  expect(end?.['isError']).toBe(false);
  const file = String((end?.['result'] as { details?: { planFile?: string } } | undefined)?.details?.planFile ?? '');
  const saved = readFileSync(file, 'utf8');
  expect(saved).toContain('    dependencies:\n      - "design"');
  expect(saved).toContain('isProject: true\nphases:\n  - name: "Design"\n    todos:\n      - id: "design"');
  expect(saved).toContain('      - id: "implement"\n        content: "Implement"\n        status: pending\n        dependencies:\n          - "design"');
});

test('building a plan imports its unfinished todos from the edited file', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  answerDialogs(rpc, ['No, propose changes']);
  rpc.send({ id: 'plan', type: 'prompt', message: '/plan' });
  await rpc.waitFor((event) => event['id'] === 'plan');
  const mark = rpc.events.length;
  rpc.send({
    type: 'prompt',
    message: script([
      {
        tool: 'CreatePlan',
        args: {
          plan: '# Build plan\n@@sys',
          todos: [
            { id: 'done', content: 'Already finished' },
            { id: 'next', content: 'Do the next step' },
            { id: 'drop', content: 'Cancelled step' },
          ],
        },
      },
    ]),
  });
  await settledAfter(rpc, mark);
  const end = rpc.events.slice(mark).find((event) => event.type === 'tool_execution_end' && event['toolName'] === 'CreatePlan');
  const file = String((end?.['result'] as { details?: { planFile?: string } } | undefined)?.details?.planFile ?? '');
  writeFileSync(
    file,
    readFileSync(file, 'utf8')
      .replace('content: "Already finished"\n    status: pending', 'content: "Already finished"\n    status: completed')
      .replace('content: "Cancelled step"\n    status: pending', 'content: "Cancelled step"\n    status: cancelled'),
  );
  const build = rpc.events.length;
  rpc.send({ type: 'prompt', message: '/plan build' });
  await settledAfter(rpc, build);
  const reply = rpc.events
    .slice(build)
    .filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant')
    .at(-1);
  const todos = /<pstack_todos>\n([\s\S]*?)\n<\/pstack_todos>/.exec(contentText((reply?.['message'] as { content: string } | undefined)?.content ?? ''))?.[1];
  expect(todos).toBe('Current todo list, owned by this session:\nTodos (0/1 completed):\n[ ] next: Do the next step');
});

test('plan-imported todos survive a Pi restart and subsequent updates synchronize the saved plan', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  const sessions = join(sandbox.root, 'sessions');
  const first = startRpc(sandbox, ['--session-dir', sessions]);
  let sessionFile = '';
  let planFile = '';
  try {
    answerDialogs(first, ['No, propose changes']);
    first.send({ id: 'plan', type: 'prompt', message: '/plan' });
    await first.waitFor((event) => event['id'] === 'plan');
    const mark = first.events.length;
    first.send({ type: 'prompt', message: script([{ tool: 'CreatePlan', args: { plan: '# Resume build', todos: [{ id: 'build', content: 'Build', dependencies: ['design'] }] } }]) });
    await settledAfter(first, mark);
    const end = first.events.slice(mark).find((event) => event.type === 'tool_execution_end' && event['toolName'] === 'CreatePlan');
    planFile = String((end?.['result'] as { details?: { planFile?: string } } | undefined)?.details?.planFile ?? '');
    const build = first.events.length;
    first.send({ type: 'prompt', message: '/plan build' });
    await settledAfter(first, build);
    first.send({ id: 'state', type: 'get_state' });
    sessionFile = String(((await first.waitFor((event) => event['id'] === 'state'))['data'] as { sessionFile: string }).sessionFile);
  } finally {
    await first.close();
  }
  const second = startRpc(sandbox, ['--session-dir', sessions, '--session', sessionFile]);
  onTestFinished(() => second.close());
  const mark = second.events.length;
  second.send({ type: 'prompt', message: script([{ tool: 'TodoWrite', args: { merge: true, todos: [{ id: 'build', status: 'completed' }] } }]) });
  await settledAfter(second, mark);
  const end = second.events.slice(mark).find((event) => event.type === 'tool_execution_end' && event['toolName'] === 'TodoWrite');
  expect(end?.['isError']).toBe(false);
  expect((end?.['result'] as { details?: { todos?: unknown } } | undefined)?.details?.todos).toEqual([{ id: 'build', content: 'Build', status: 'completed', dependencies: ['design'] }]);
  expect(readFileSync(planFile, 'utf8')).toContain('    status: completed\n    dependencies:\n      - "design"');
});

test.for([false, true])('a worktree plan builder retains its todos and honors readonly %j when resumed', async (readonly, { onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: sandbox.workDir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'initial', '--allow-empty'], { cwd: sandbox.workDir });
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  answerDialogs(rpc, ['Yes, build in cloud']);
  rpc.send({ id: 'plan', type: 'prompt', message: '/plan' });
  await rpc.waitFor((event) => event['id'] === 'plan');
  const mark = rpc.events.length;
  rpc.send({
    type: 'prompt',
    message: script([
      {
        tool: 'CreatePlan',
        args: {
          plan: '# Worker plan\n\n@@sys',
          todos: [
            { id: 'design', content: 'Design' },
            { id: 'build', content: 'Build', dependencies: ['design'] },
          ],
        },
      },
    ]),
  });
  const notice = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { customType?: string }).customType === 'pstack/task');
  const message = notice['message'] as { content: string; details: { agentId: string; status: string } };
  expect(message.details.status).toBe('success');
  expect(contentText(message.content)).toContain('<pstack_todos>\nCurrent todo list, owned by this session:\nTodos (0/2 completed):\n[ ] design: Design\n[ ] build: Build (depends on design)\n</pstack_todos>');
  const planFile = String((toolEnds(rpc.events.slice(mark), 'CreatePlan')[0]?.details as { planFile?: string } | undefined)?.planFile ?? '');
  const before = readFileSync(planFile, 'utf8');
  await settledAfter(rpc, rpc.events.indexOf(notice));
  const resumed = rpc.events.length;
  rpc.send({
    type: 'prompt',
    message: script([{ tool: 'Task', args: { description: 'Finish the plan', resume: message.details.agentId, readonly, prompt: script([{ tool: 'TodoWrite', args: { merge: true, todos: [{ id: 'build', status: 'completed' }] } }]) } }]),
  });
  await settledAfter(rpc, resumed);
  const result = toolEnds(rpc.events.slice(resumed), 'Task')[0];
  expect(result?.isError).toBe(false);
  expect(result?.text).toContain('[x] build: Build (depends on design)');
  expect(readFileSync(planFile, 'utf8')).toBe(readonly ? before : before.replace('content: "Build"\n    status: pending', 'content: "Build"\n    status: completed'));
});

test.for([true, false])('TodoWrite preserves reviewed plan text with a preexisting status %j', async (statusPresent, { onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  answerDialogs(rpc, ['No, propose changes']);
  rpc.send({ id: 'plan', type: 'prompt', message: '/plan' });
  await rpc.waitFor((event) => event['id'] === 'plan');
  const mark = rpc.events.length;
  rpc.send({ type: 'prompt', message: script([{ tool: 'CreatePlan', args: { plan: '# Preserve me\n\nBody text stays.', todos: [{ id: 'step', content: 'Finish this step' }] } }]) });
  await settledAfter(rpc, mark);
  const end = rpc.events.slice(mark).find((event) => event.type === 'tool_execution_end' && event['toolName'] === 'CreatePlan');
  const file = String((end?.['result'] as { details?: { planFile?: string } } | undefined)?.details?.planFile ?? '');
  const reviewed = readFileSync(file, 'utf8').replace('isProject: false', '    dependencies: [prior]\ncustom: "Keep this value"\nisProject: false');
  const before = statusPresent ? reviewed : reviewed.replace('    status: pending\n', '');
  writeFileSync(file, before);
  const update = rpc.events.length;
  rpc.send({ type: 'prompt', message: script([{ tool: 'TodoWrite', args: { merge: false, todos: [{ id: 'step', content: 'Finish this step', status: 'completed' }] } }]) });
  await settledAfter(rpc, update);
  const result = rpc.events.slice(update).find((event) => event.type === 'tool_execution_end' && event['toolName'] === 'TodoWrite');
  expect(result?.['isError']).toBe(false);
  const expected = statusPresent ? before.replace('status: pending', 'status: completed') : before.replace('- id: "step"', '- status: completed\n    id: "step"');
  expect(readFileSync(file, 'utf8')).toBe(expected);
});

test.for([true, false])('navigating out of the planning branch restores tools with an earlier recorded loadout %j', async (recordedLoadout, { onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  const reply = async (message: string) => {
    const mark = rpc.events.length;
    rpc.send({ type: 'prompt', message });
    await settledAfter(rpc, mark);
    const end = rpc.events
      .slice(mark)
      .filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant')
      .at(-1);
    return contentText((end?.['message'] as { content: string } | undefined)?.content ?? '');
  };
  const before = await reply('before\n@@tools-list');
  if (!recordedLoadout) {
    rpc.send({ id: 'new', type: 'new_session' });
    await rpc.waitFor((event) => event['id'] === 'new');
    rpc.send({ id: 'mode', type: 'prompt', message: '/mode tdd' });
    await rpc.waitFor((event) => event['id'] === 'mode');
  }
  rpc.send({ id: 'entries', type: 'get_entries' });
  const entries = (await rpc.waitFor((event) => event['id'] === 'entries'))['data'] as { entries: { id: string; type: string; message?: { role: string } }[] };
  const target = entries.entries.at(-1)?.id;
  expect(typeof target).toBe('string');

  rpc.send({ id: 'plan', type: 'prompt', message: '/plan' });
  await rpc.waitFor((event) => event['id'] === 'plan');
  expect((await reply('planning\n@@tools-list')).split(',')).not.toContain('bash');
  rpc.send({ id: 'tree', type: 'prompt', message: `/test-tree ${target}` });
  await rpc.waitFor((event) => event['id'] === 'tree');

  expect((await reply('after\n@@tools-list')).split(',').toSorted()).toEqual(before.split(',').toSorted());
  expect(await reply('after\n@@sys')).not.toContain('<pstack_plan>');
});

test('SwitchMode enters plan mode with the user approving, and /plan build starts the saved plan', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  answerDialogs(rpc, [true, 'No, propose changes']);
  const mark = rpc.events.length;
  rpc.send({
    type: 'prompt',
    message: script([
      { tool: 'SwitchMode', args: { target_mode_id: 'plan', explanation: 'Several designs fit.' } },
      { tool: 'CreatePlan', args: { plan: '# Switched plan' } },
    ]),
  });
  await settledAfter(rpc, mark);
  const ends = rpc.events.slice(mark).filter((event) => event.type === 'tool_execution_end');
  expect(ends.map((event) => [event['toolName'], event['isError']])).toEqual([
    ['SwitchMode', false],
    ['CreatePlan', false],
  ]);
  const planFile = String((ends[1]?.['result'] as { details?: { planFile?: string } } | undefined)?.details?.planFile);
  await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'select');
  rpc.send({ type: 'prompt', message: '/plan build' });
  const build = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'user' && contentText((event['message'] as { content: string }).content).startsWith('Build the plan saved at'));
  expect(contentText((build['message'] as { content: string }).content)).toBe([`Build the plan saved at ${planFile}. Follow it.`, '', '# Switched plan'].join('\n'));
});
