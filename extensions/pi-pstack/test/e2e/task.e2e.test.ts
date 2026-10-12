import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { assistantTexts, contentText, makeSandbox, type PiEvent, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

const AGENT_ID = /Agent ID: ([0-9a-f-]{36})/;

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.dispose());

const task = (args: Record<string, unknown>) => ({ tool: 'Task', args: { description: 'probe', ...args } });
const slug = (cwd: string) => `--${cwd.replace(/^\//, '').replace(/[/\\:]/g, '-')}--`;
const subagentDir = (cwd = sandbox.workDir) => join(sandbox.agentDir, 'pstack/workspaces', slug(cwd), 'subagents');
const transcriptOf = (agentId: string) => {
  const file = readdirSync(subagentDir()).find((name) => name.endsWith(`_${agentId}.jsonl`));
  if (file === undefined) throw new Error(`no transcript for ${agentId}`);
  return readFileSync(join(subagentDir(), file), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; message?: { role: string; content: unknown; thinkingLevel?: string } });
};
const idOf = (text: string | undefined) => {
  const id = AGENT_ID.exec(text ?? '')?.[1];
  if (id === undefined) throw new Error(`no agent ID in: ${text}`);
  return id;
};

async function runTask(args: Record<string, unknown>) {
  const run = await runJson(sandbox, script([task(args)]), ['--no-session']);
  const [result] = toolEnds(run.events, 'Task');
  if (result === undefined) throw new Error(`Task never ran\n${run.stderr}`);
  return { run, result };
}

describe('foreground', () => {
  test('returns the response in Cursor format with agent ID, usage, and a transcript (TASK-002, TASK-012, TASK-014)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@say PONG-FG', run_in_background: false });
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/^This is the output of the subagent:\n\nresponse:\n<response>\nPONG-FG\n<\/response>\n\nAgent ID: [0-9a-f-]{36} \(pass it as `resume` to send a follow-up after it completes\)\nTranscript: /);
    expect(result.usage?.totalTokens).toBeGreaterThan(100);
    const entries = transcriptOf(idOf(result.text));
    expect(entries[0]?.type).toBe('session');
    expect(entries.filter((entry) => entry.message?.role === 'assistant').map((entry) => contentText(entry.message?.content as string))).toEqual(['PONG-FG']);
  });

  test('a failed child returns an error status with its message (TASK-015)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@fail boom' });
    expect(result.isError).toBe(true);
    expect(result.text.startsWith('Subagent failed: boom')).toBe(true);
  });

  test('an invalid model fails with the allowed list before any child starts (TASK-007)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@say X', model: 'no-such-model' });
    expect(result.isError).toBe(true);
    expect(result.text.split('\n').slice(0, 4)).toEqual([
      'Invalid model selection "no-such-model". Model could not be resolved to a valid subagent model.',
      'Allowed model slugs:',
      '- inherit',
      '- scripted/echo (thinking: off, minimal, low, medium, high)',
    ]);
  });

  test('a Cursor slug picks the model and thinking level (TASK-007)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@say HI', model: 'echo-high' });
    expect(result.details).toMatchObject({ model: { provider: 'scripted', id: 'echo', thinking: 'high' } });
    const assistant = transcriptOf(idOf(result.text)).find((entry) => entry.message?.role === 'assistant');
    expect(assistant?.message?.thinkingLevel).toBe('high');
  });

  test('environment cloud is refused (TASK-010)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@say X', environment: 'cloud' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Pi has no cloud subagents');
  });

  test('file attachments reach the child first message (TASK-016)', async () => {
    writeFileSync(join(sandbox.workDir, 'note.txt'), 'ATTACHED-CONTENT-7');
    const { result } = await runTask({ prompt: 'go\n@@say GOT', file_attachments: ['note.txt'] });
    const user = transcriptOf(idOf(result.text)).find((entry) => entry.message?.role === 'user');
    expect(JSON.stringify(user?.message?.content)).toContain('ATTACHED-CONTENT-7');
  });
});

describe('subagent types', () => {
  test('comment-sicko runs with its agent body in the system prompt (TASK-006)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@sys', subagent_type: 'comment-sicko' });
    expect(result.text).toContain('<pstack_agent>\n# Comment Sicko\n\nMy first output when spawned is exactly this.');
  });

  test('readonly limits the child to read, grep, find, ls, and its todo list (TASK-008)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@tools-list', readonly: true });
    const tools = /<response>\n(.*)\n<\/response>/.exec(result.text)?.[1]?.split(',');
    expect(tools?.toSorted()).toEqual(['TodoWrite', 'find', 'grep', 'ls', 'read']);
  });

  test('a subagent gets the project resources its parent trusted (review r2: security)', async () => {
    mkdirSync(join(sandbox.workDir, '.pi/skills/projskill'), { recursive: true });
    writeFileSync(join(sandbox.workDir, '.pi/skills/projskill/SKILL.md'), '---\nname: projskill\ndescription: PROJECT-SKILL-MARKER\n---\nBody.\n');
    const sees = async (flag: string) =>
      (await runJson(sandbox, script([task({ prompt: 'go\n@@sys' })]), ['--no-session', flag])).events.some((event) => JSON.stringify(event).includes('PROJECT-SKILL-MARKER') && event.type === 'tool_execution_end');
    expect([await sees('--approve'), await sees('--no-approve')]).toEqual([true, false]);
  });

  test('a normal child has write tools and the pstack tools', async () => {
    const { result } = await runTask({ prompt: 'go\n@@tools-list' });
    const tools = /<response>\n(.*)\n<\/response>/.exec(result.text)?.[1]?.split(',') ?? [];
    expect(tools.filter((name) => ['bash', 'edit', 'write', 'Task', 'TodoWrite'].includes(name)).toSorted()).toEqual(['Task', 'TodoWrite', 'bash', 'edit', 'write']);
  });

  test('an unknown type fails with the valid list (TASK-006)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@say X', subagent_type: 'explore' });
    expect(result.text).toBe('Unknown subagent_type "explore". Available subagent types: generalPurpose, comment-sicko, poteto-agent.');
  });

  test('a subagent of a subagent cannot launch more (TASK-011)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@task-chain 2' });
    expect([result.text.includes('[Task] This is the output of the subagent:'), result.text.includes('[Task error] Tool Task not found')]).toEqual([true, true]);
  });
});

describe('background and parallel', () => {
  test('returns at once and delivers a <task> notification after the turn (TASK-003)', async () => {
    const run = await runJson(sandbox, script([task({ prompt: 'go\n@@sleep 1500 PONG-BG', run_in_background: true })]), ['--no-session']);
    const [launch] = toolEnds(run.events, 'Task');
    expect(launch?.text.startsWith('Subagent is running in the background. Its final response arrives automatically after your turn ends')).toBe(true);
    const agentId = idOf(launch?.text);
    const notice = run.events
      .filter((event) => event.type === 'entry_appended')
      .map((event) => event['entry'] as { type: string; customType?: string; content: string })
      .filter((entry) => entry.type === 'custom_message' && entry.customType === 'pstack/task')
      .map((entry) => entry.content);
    expect(notice).toEqual([
      `The following task has finished. If you already handled it, ignore this notification and do not restate earlier responses.\n\n<task>\nkind: subagent\nstatus: success\ntask_id: ${agentId}\ntitle: go @@sleep 1500 PONG-BG\ntool_call_id: ${(run.events.find((event) => event.type === 'tool_execution_end')?.['toolCallId'] as string) ?? ''}\ndetail: PONG-BG\n</task>`,
    ]);
    const texts = assistantTexts(run.events).filter((text) => text !== '');
    expect(texts).toHaveLength(2);
    expect(texts[0]?.startsWith('RESULTS:\n[Task] Subagent is running in the background.')).toBe(true);
    expect(texts[1]?.startsWith('ECHO: The following task has finished.')).toBe(true);
  });

  test('while a subagent runs, its run lock names the child process that writes the transcript (recheck)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: script([task({ prompt: 'go\n@@sleep 4000 SLOW', run_in_background: true })]) });
      const launch = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task');
      const { agentId, pid } = (launch['result'] as { details: { agentId: string; pid: number } }).details;
      expect(readFileSync(join(subagentDir(), `${agentId}.lock`), 'utf8')).toBe(String(pid));
    } finally {
      await rpc.close();
    }
  });

  test('the background notification records the child usage (review r2: architecture 1)', async () => {
    const run = await runJson(sandbox, script([task({ prompt: 'go\n@@say BG', run_in_background: true })]), ['--no-session']);
    const entry = run.events
      .filter((event) => event.type === 'entry_appended')
      .map((event) => event['entry'] as { customType?: string; details?: { agentId: string; usage?: { totalTokens: number } } })
      .find((candidate) => candidate.customType === 'pstack/task');
    const spent = transcriptOf(entry?.details?.agentId ?? '')
      .filter((line) => line.message?.role === 'assistant')
      .reduce((sum, line) => sum + ((line.message as { usage?: { totalTokens: number } }).usage?.totalTokens ?? 0), 0);
    expect([spent > 0, entry?.details?.usage?.totalTokens]).toEqual([true, spent]);
  });

  test('a failed background child notifies with status error and its message (TASK-015)', async () => {
    const run = await runJson(sandbox, script([task({ prompt: 'go\n@@fail boom', run_in_background: true })]), ['--no-session']);
    const notice = run.events
      .filter((event) => event.type === 'entry_appended')
      .map((event) => event['entry'] as { customType?: string; content?: string })
      .find((candidate) => candidate.customType === 'pstack/task');
    expect(notice?.content?.split('\n').filter((line) => line.startsWith('status:') || line.startsWith('detail:'))).toEqual(['status: error', 'detail: boom']);
  });

  test('poteto-agent runs in the background by default (TASK-009)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@say POTETO', subagent_type: 'poteto-agent' });
    expect(result.text.startsWith('Subagent is running in the background.')).toBe(true);
    expect(result.details).toMatchObject({ subagentType: 'poteto-agent', background: true });
  });

  test('two Task calls in one message run at the same time (TASK-004)', async () => {
    const run = await runJson(sandbox, script([[task({ prompt: 'go\n@@sleep 1200 A' }), task({ prompt: 'go\n@@sleep 1200 B' })]]), ['--no-session']);
    const lifecycle = run.events.filter((event) => event['toolName'] === 'Task' && (event.type === 'tool_execution_start' || event.type === 'tool_execution_end')).map((event) => event.type);
    expect(lifecycle).toEqual(['tool_execution_start', 'tool_execution_start', 'tool_execution_end', 'tool_execution_end']);
    expect(
      toolEnds(run.events, 'Task')
        .map((end) => /<response>\n(.*)\n<\/response>/.exec(end.text)?.[1])
        .toSorted(),
    ).toEqual(['A', 'B']);
  });
});

describe('usage accounting', () => {
  const tokens = (usage: { input: number; output: number; cacheRead: number; cacheWrite: number }) => usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

  test('foreground usage includes what the child spent on its own subagent (review r2: architecture 2)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@task-chain 1' });
    const entries = transcriptOf((result.details as { agentId: string }).agentId);
    const spent = (role: string) => entries.filter((entry) => entry.message?.role === role).reduce((sum, entry) => sum + ((entry.message as { usage?: { totalTokens: number } }).usage?.totalTokens ?? 0), 0);
    expect([spent('toolResult') > 0, result.usage?.totalTokens]).toEqual([true, spent('assistant') + spent('toolResult')]);
  });

  test('foreground subagent usage enters the session totals (TASK-014)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: script([task({ prompt: 'go\n@@say FG' })]) });
      const end = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task');
      await rpc.waitFor((event) => event.type === 'agent_settled');
      rpc.send({ id: 'stats', type: 'get_session_stats' });
      const stats = (await rpc.waitFor((event) => event['id'] === 'stats'))['data'] as { tokens: { total: number } };
      const own = rpc.events
        .filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant')
        .reduce((sum, event) => sum + tokens((event['message'] as { usage: Parameters<typeof tokens>[0] }).usage), 0);
      const child = tokens((end['result'] as { usage: Parameters<typeof tokens>[0] }).usage);
      expect([child > 0, stats.tokens.total]).toEqual([true, own + child]);
    } finally {
      await rpc.close();
    }
  });
});

describe('resume over RPC', () => {
  const settledAfter = (rpc: ReturnType<typeof startRpc>, mark: number) => (event: PiEvent) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark;

  test('continues the same transcript, refuses running and unknown agents (TASK-005)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      const prompt = async (message: string) => {
        const mark = rpc.events.length;
        rpc.send({ type: 'prompt', message });
        await rpc.waitFor(settledAfter(rpc, mark));
        return toolEnds(rpc.events.slice(mark), 'Task');
      };
      const [first] = await prompt(script([task({ prompt: 'go\n@@say ONE' })]));
      const agentId = idOf(first?.text);
      const [resumed] = await prompt(script([task({ prompt: 'again\n@@count', resume: agentId, model: 'scripted/plain' })]));
      expect(/<response>\n(.*)\n<\/response>/.exec(resumed?.text ?? '')?.[1]).toBe('USERS=2');
      expect(resumed?.text.endsWith('Note: model "scripted/plain" was ignored; a resumed agent keeps its earlier model.')).toBe(true);

      const [slow] = await prompt(script([task({ prompt: 'go\n@@sleep 4000 SLOW', run_in_background: true })]));
      const [busy] = await prompt(script([task({ prompt: 'x', resume: idOf(slow?.text) })]));
      expect(busy?.text).toBe(`Agent ${idOf(slow?.text)} is still running. Wait for its completion notification before resuming it.`);
      const [unknown] = await prompt(script([task({ prompt: 'x', resume: '00000000-0000-4000-8000-000000000000' })]));
      expect(unknown?.text).toBe('Unknown agent ID 00000000-0000-4000-8000-000000000000. Resume needs an agent ID returned by an earlier Task call in this workspace.');
      const notice = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'custom');
      expect(contentText((notice['message'] as { content: string }).content)).toContain(`task_id: ${idOf(slow?.text)}\n`);
    } finally {
      await rpc.close();
    }
  });
});

describe('resume across processes and workspaces', () => {
  test('a new Pi process in the same workspace resumes the agent with its context (TASK-005)', async () => {
    const first = await runJson(sandbox, script([task({ prompt: 'go\n@@say ONE' })]), ['--no-session']);
    const agentId = idOf(toolEnds(first.events, 'Task')[0]?.text);
    const second = await runJson(sandbox, script([task({ prompt: 'again\n@@count', resume: agentId })]), ['--no-session']);
    expect(/<response>\n(.*)\n<\/response>/.exec(toolEnds(second.events, 'Task')[0]?.text ?? '')?.[1]).toBe('USERS=2');
    expect(readdirSync(subagentDir()).filter((name) => name.endsWith(`_${agentId}.jsonl`))).toHaveLength(1);
  });

  test('another workspace cannot resume it, so agents never cross workspaces (review: parity 4, security)', async () => {
    const first = await runJson(sandbox, script([task({ prompt: 'go\n@@say ONE' })]), ['--no-session']);
    const agentId = idOf(toolEnds(first.events, 'Task')[0]?.text);
    const elsewhere = { ...sandbox, workDir: join(sandbox.root, 'elsewhere') };
    mkdirSync(elsewhere.workDir);
    const second = await runJson(elsewhere, script([task({ prompt: 'again\n@@count', resume: agentId })]), ['--no-session']);
    expect(toolEnds(second.events, 'Task')[0]?.text).toBe(`Unknown agent ID ${agentId}. Resume needs an agent ID returned by an earlier Task call in this workspace.`);
  });

  test('two calls in one message that resume the same agent get one writer (review: security 3, architecture 2)', async () => {
    const first = await runJson(sandbox, script([task({ prompt: 'go\n@@say ONE' })]), ['--no-session']);
    const agentId = idOf(toolEnds(first.events, 'Task')[0]?.text);
    const second = await runJson(sandbox, script([[task({ prompt: 'a\n@@sleep 1500 A', resume: agentId }), task({ prompt: 'b\n@@say B', resume: agentId })]]), ['--no-session']);
    const texts = toolEnds(second.events, 'Task').map((end) => end.text.split('\n')[0]);
    expect(texts.toSorted()).toEqual([`Agent ${agentId} is still running. Wait for its completion notification before resuming it.`, 'This is the output of the subagent:']);
  });
});

describe('resume edge cases', () => {
  const record = (agentId: string, type: string) => {
    mkdirSync(subagentDir(), { recursive: true });
    writeFileSync(join(subagentDir(), `${agentId}.json`), JSON.stringify({ agentId, type, readonly: false, cwd: sandbox.workDir, createdAt: '2026-10-12T00:00:00.000Z' }));
  };

  test('honors readonly: true for an agent that started writable (review r2: security 2)', async () => {
    const first = await runJson(sandbox, script([task({ prompt: 'go\n@@say ONE' })]), ['--no-session']);
    const agentId = idOf(toolEnds(first.events, 'Task')[0]?.text);
    const second = await runJson(sandbox, script([task({ prompt: 'again\n@@tools-list', resume: agentId, readonly: true })]), ['--no-session']);
    const tools = /<response>\n(.*)\n<\/response>/.exec(toolEnds(second.events, 'Task')[0]?.text ?? '')?.[1]?.split(',');
    expect(tools?.toSorted()).toEqual(['TodoWrite', 'find', 'grep', 'ls', 'read']);
  });

  test('refuses an agent whose transcript is missing instead of starting it fresh (review r2: security)', async () => {
    const agentId = '22222222-3333-4444-8555-666666666666';
    record(agentId, 'generalPurpose');
    const { result } = await runTask({ prompt: 'again\n@@count', resume: agentId });
    expect(result.text).toBe(`Agent ${agentId} has no transcript to resume, so its earlier context is gone. Start a new agent instead.`);
  });

  test('explains a recorded type this version no longer has (review r2: architecture 5)', async () => {
    const agentId = '33333333-4444-4555-8666-777777777777';
    record(agentId, 'Comment Sicko');
    writeFileSync(join(subagentDir(), `2026-10-12T00-00-00-000Z_${agentId}.jsonl`), `${JSON.stringify({ type: 'session', version: 3, id: agentId, cwd: sandbox.workDir })}\n`);
    const { result } = await runTask({ prompt: 'again', resume: agentId });
    expect(result.text).toBe(`Agent ${agentId} was a "Comment Sicko" subagent, a type this version no longer has. Start a new agent instead.`);
  });

  test('a subagent that resumes a depth-1 agent runs it one level down, so nesting stays capped (recheck r2: 1)', async () => {
    const first = await runJson(sandbox, script([task({ prompt: 'go\n@@say ONE' })]), ['--no-session']);
    const agentId = idOf(toolEnds(first.events, 'Task')[0]?.text);
    const resumeFromChild = JSON.stringify([{ tool: 'Task', args: { description: 'r', prompt: 'again\n@@tools-list', resume: agentId } }]);
    const { result } = await runTask({ prompt: `go\n@@script ${resumeFromChild}` });
    const nested = /<response>\n([^\n]*)\n<\/response>/.exec(/<response>\n([\s\S]*)\n<\/response>/.exec(result.text)?.[1] ?? '')?.[1]?.split(',') ?? [];
    expect([nested.includes('TodoWrite'), nested.includes('Task')]).toEqual([true, false]);
  });

  test('refuses an agent whose record names another working directory (recheck r2)', async () => {
    const agentId = '44444444-5555-4666-8777-888888888888';
    mkdirSync(subagentDir(), { recursive: true });
    writeFileSync(join(subagentDir(), `${agentId}.json`), JSON.stringify({ agentId, type: 'generalPurpose', readonly: false, cwd: '/elsewhere/with-a-colliding-name', createdAt: '2026-10-12T00:00:00.000Z' }));
    writeFileSync(join(subagentDir(), `2026-10-12T00-00-00-000Z_${agentId}.jsonl`), `${JSON.stringify({ type: 'session', version: 3, id: agentId, cwd: '/elsewhere/with-a-colliding-name' })}\n`);
    const { result } = await runTask({ prompt: 'again', resume: agentId });
    expect(result.text).toBe(`Agent ${agentId} belongs to /elsewhere/with-a-colliding-name, not this workspace. Start a new agent instead.`);
  });

  test('an agent keeps its depth on resume, so the root cannot lift a grandchild (review r2: architecture)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@task-chain 1' });
    const grandchild = idOf(/<response>\n([\s\S]*)\n<\/response>/.exec(result.text)?.[1]);
    const resumed = await runTask({ prompt: 'again\n@@tools-list', resume: grandchild });
    const tools = /<response>\n(.*)\n<\/response>/.exec(resumed.result.text)?.[1]?.split(',') ?? [];
    expect([tools.includes('TodoWrite'), tools.includes('Task')]).toEqual([true, false]);
  });
});

describe('child environment', () => {
  test('a bad attachment leaves no agent record behind (review: security 4, architecture 8)', async () => {
    const { result } = await runTask({ prompt: 'go\n@@say X', file_attachments: ['missing.png'] });
    expect([result.isError, result.text]).toEqual([true, `file_attachments: ${join(sandbox.workDir, 'missing.png')} does not exist`]);
    expect(existsSync(subagentDir()) ? readdirSync(subagentDir()) : []).toEqual([]);
  });

  test("commands a subagent runs do not inherit the port's variables (review: architecture)", async () => {
    const { result } = await runTask({ prompt: 'go\n@@script [{"tool":"bash","args":{"command":"env | grep -c PI_PSTACK || true"}}]' });
    expect(/<response>\n([\s\S]*)\n<\/response>/.exec(result.text)?.[1]).toBe('RESULTS:\n[bash] 0\n');
  });
});

describe('cancellation', () => {
  // Pi sets process.title to "pi", so ps cannot find a child by its arguments; the Task details carry its pid.
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  async function gone(pids: readonly number[], timeoutMs = 12_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pids.every((pid) => !alive(pid))) return true;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return pids.every((pid) => !alive(pid));
  }
  const childrenOf = (pid: number) =>
    execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(([, parent]) => parent === pid)
      .map(([child]) => child as number);
  const detailsPid = (event: PiEvent, key: 'result' | 'partialResult') => (event[key] as { details: { pid: number } }).details.pid;

  test('aborting the parent turn stops a foreground child (TASK-013)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: script([task({ prompt: 'go\n@@sleep 60000 SLOW' })]) });
      const update = await rpc.waitFor((event) => event.type === 'tool_execution_update' && event['toolName'] === 'Task');
      const pid = detailsPid(update, 'partialResult');
      expect(alive(pid)).toBe(true);
      rpc.send({ type: 'abort' });
      await rpc.waitFor((event) => event.type === 'agent_settled');
      expect(await gone([pid])).toBe(true);
    } finally {
      await rpc.close();
    }
  });

  test('closing the session stops a background child (TASK-013)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    rpc.send({ type: 'prompt', message: script([task({ prompt: 'go\n@@sleep 60000 SLOW', run_in_background: true })]) });
    const launch = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task');
    const pid = detailsPid(launch, 'result');
    expect(alive(pid)).toBe(true);
    await rpc.close();
    // Pi's exit also orphans the child, and its watchdog would end it, so this checks the outcome and the notice.
    // The shutdown kill itself is proven by the reload and new-session tests in lifecycle.e2e.test.ts.
    const notice = rpc.events.find((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith('Stopped '));
    expect([notice?.['message'], await gone([pid])]).toEqual(['Stopped 1 background subagent (session quit). Resume one with its agent ID.', true]);
  });

  // A silent bash command writes nothing to stdout, so an orphaned child gets no EPIPE and only the watchdog ends it.
  test('a subagent busy in a silent command exits when its parent is killed outright (review: parity 5)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    rpc.send({ type: 'prompt', message: script([task({ prompt: 'go\n@@script [{"tool":"bash","args":{"command":"sleep 45"}}]', run_in_background: true })]) });
    const launch = await rpc.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task');
    const pid = detailsPid(launch, 'result');
    const deadline = Date.now() + 10_000;
    while (childrenOf(pid).length === 0 && Date.now() < deadline) await new Promise<void>((resolve) => setImmediate(resolve));
    const shell = childrenOf(pid);
    expect([alive(pid), shell.length > 0]).toEqual([true, true]);
    rpc.child.kill('SIGKILL');
    await rpc.close();
    expect(await gone([pid, ...shell])).toBe(true);
  });
});
