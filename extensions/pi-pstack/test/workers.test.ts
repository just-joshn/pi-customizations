import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { registerWorkers, restoreTaskRecords, taskSummary } from '../src/workers.ts';

const record = {
  id: 'task-one', persona: 'poteto-agent', cwd: '/tmp/project', readonly: false,
  sessionFile: '/tmp/session.jsonl', outputFile: '/tmp/output.txt', status: 'running', output: '',
} satisfies Parameters<typeof taskSummary>[0];

test('restore tasks from real Pi branch entries and mark unfinished tasks interrupted', () => {
  const manager = SessionManager.inMemory('/tmp/project');
  const base = manager.appendCustomEntry('pstack-task', record);
  manager.appendCustomEntry('pstack-task', { ...record, status: 'settled', output: 'done' });
  assert.equal(restoreTaskRecords(manager.getBranch()).get(record.id)?.status, 'settled');
  manager.branch(base);
  assert.equal(restoreTaskRecords(manager.getBranch()).get(record.id)?.status, 'interrupted');
  manager.appendCustomEntry('pstack-task', { ...record, id: 42 });
  assert.equal(restoreTaskRecords(manager.getBranch()).size, 1);
});

test('output bounds retain the durable transcript and complete-output pointer', () => {
  const summary = JSON.parse(taskSummary({ ...record, output: 'a'.repeat(15000) }));
  assert.equal(summary.output.length, 12000);
  assert.equal(summary.output_file, '/tmp/output.txt');
  assert.equal(summary.transcript, '/tmp/session.jsonl');
});

test('official SDK loads all worker tools without spawning children', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-workers-test-'));
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  try {
    const settingsManager = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [registerWorkers] });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    session = (await createAgentSession({ cwd: dir, agentDir: dir, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(dir) })).session;
    await session.bindExtensions({ mode: 'print' });
    const context = session.extensionRunner.createContext();
    const task = loader.getExtensions().extensions.flatMap(extension => [...extension.tools.values()]).find(tool => tool.definition.name === 'Task');
    assert.ok(task);
    await assert.rejects(task.definition.execute('cloud-test', { prompt: 'test', environment: 'cloud' }, undefined, undefined, context), /cloud execution is unavailable/);
    await assert.rejects(task.definition.execute('resume-test', { prompt: 'test', resume: 'other-branch' }, undefined, undefined, context), /Unknown task in this branch/);
    const names = session.getActiveToolNames();
    for (const name of ['Task', 'TaskOutput', 'TaskStop', 'TaskMessage']) assert.ok(names.includes(name), name);
  } finally { session?.dispose(); await rm(dir, { recursive: true, force: true }); }
});


test('real child sessions preserve history and report provider failures, background output, and cancellation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-child-'));
  const priorDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  try {
    await mkdir(join(dir, 'extensions'));
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
    const ai = resolve('node_modules/@earendil-works/pi-ai/dist/index.js');
    await writeFile(join(dir, 'extensions/provider.ts'), `
      import { appendFileSync, writeFileSync } from 'node:fs';
      import { createAssistantMessageEventStream } from ${JSON.stringify(ai)};
      export default function (pi) {
        pi.registerProvider('worker-test', {
          api: 'openai-completions', baseUrl: 'https://unused.invalid', apiKey: 'test-only',
          models: [{ id: 'deterministic', name: 'Deterministic', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
          streamSimple(model, context, options) {
            const stream = createAssistantMessageEventStream();
            const users = context.messages.filter(m => m.role === 'user');
            const text = JSON.stringify(users.at(-1));
            writeFileSync(${JSON.stringify(join(dir, 'child-system.txt'))}, JSON.stringify(context.messages.filter(message => message.role === 'system')));
            const error = text.includes('FAIL');
            const nested = text.includes('NEST_ROOT') || text.includes('NEST_STOP');
            const last = context.messages.at(-1);
            const grandchild = text.includes('GRANDCHILD');
            const auditFile = ${JSON.stringify(join(dir, 'audit.txt'))};
            const log = (event) => appendFileSync(auditFile, event + '\\n');
            if (grandchild) log('grandchild-start');
            const taskCall = nested && last?.role === 'user' ? { type: 'toolCall', id: 'nested-task', name: 'Task', arguments: { prompt: 'WAIT GRANDCHILD', model: 'worker-test/deterministic' } } : undefined;

            const finish = (aborted = false) => {
              if (grandchild) log(aborted ? 'grandchild-aborted' : 'grandchild-finished');
              if (nested && !taskCall) log(aborted ? 'parent-aborted' : 'parent-finished');
              const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
                content: taskCall ? [taskCall] : [{ type: 'text', text: 'users=' + users.length }],
                stopReason: aborted ? 'aborted' : error ? 'error' : taskCall ? 'toolUse' : 'stop',
                errorMessage: error ? 'scripted failure' : undefined, timestamp: Date.now(),
                usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
              stream.push(aborted || error ? { type: 'error', reason: message.stopReason, error: message } : { type: 'done', reason: taskCall ? 'toolUse' : 'stop', message });
              stream.end(message);
            };
            if (options?.signal?.aborted) { finish(true); return stream; }
            if (text.includes('WAIT') || (nested && !taskCall)) {
              const timer = setTimeout(() => finish(), grandchild || text.includes('NEST_STOP') ? 500 : text.includes('NEST_ROOT') ? 20 : 100);
              options?.signal?.addEventListener('abort', () => { clearTimeout(timer); finish(true); }, { once: true });
            } else finish();
            return stream;
          }
        });
      }
    `);
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noSkills: true, noContextFiles: true, extensionFactories: [registerWorkers] });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    session = (await createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader, sessionManager: SessionManager.create(dir, join(dir, 'sessions')) })).session;
    await session.bindExtensions({ mode: 'print' });
    const context = session.extensionRunner.createContext();
    const model = context.modelRegistry.getAvailable().find(model => model.provider === 'worker-test');
    assert.ok(model);
    await session.setModel(model);
    const tools = loader.getExtensions().extensions.flatMap(extension => [...extension.tools.values()]);
    async function call(name: string, params: Record<string, unknown>) {
      const tool = tools.find(tool => tool.definition.name === name);
      assert.ok(tool);
      return tool.definition.execute('test-' + name, params, undefined, undefined, session!.extensionRunner.createContext());
    }
    await assert.rejects(call('Task', { prompt: 'watch', subagent_type: 'ci-watcher' }), /Unavailable model 'fast'/);
    for (const role of ['shell', 'explore']) {
      await assert.rejects(call('Task', { prompt: 'prepare', subagent_type: role }), /Unsupported agent/);
    }
    const watcher = await call('Task', { prompt: 'watch', subagent_type: 'ci-watcher', model: 'worker-test/deterministic', run_in_background: false });
    const watcherData = JSON.parse(watcher.content.find(block => block.type === 'text')!.text);
    assert.equal(watcherData.status, 'settled');
    let childPrompt = await readFile(join(dir, 'child-system.txt'), 'utf8');
    assert.match(childPrompt, /CI monitoring specialist for PR-attached checks/);
    assert.match(childPrompt, /# No inline imports/);
    assert.match(childPrompt, /typescript-exhaustive-switch: In switch statements/);
    await call('Task', { prompt: 'watch again', resume: watcherData.task_id, run_in_background: false });
    await call('Task', { prompt: 'review', subagent_type: 'thermo-nuclear-code-quality-review', model: 'worker-test/deterministic', run_in_background: false });
    childPrompt = await readFile(join(dir, 'child-system.txt'), 'utf8');
    assert.match(childPrompt, /You are a \*\*Task subagent\*\*/);
    assert.match(childPrompt, /## Approval Bar/);
    const appended: string[][] = [];
    const getAppendSystemPrompt = DefaultResourceLoader.prototype.getAppendSystemPrompt;
    const observer = t.mock.method(DefaultResourceLoader.prototype, 'getAppendSystemPrompt', function (this: DefaultResourceLoader) {
      const prompts = getAppendSystemPrompt.call(this);
      if (this.getExtensions().extensions.length === 0) appended.push(prompts);
      return prompts;
    });
    await assert.rejects(call('Task', { prompt: 'readonly review', subagent_type: 'thermo-nuclear-code-quality-review', model: 'worker-test/deterministic', readonly: true, run_in_background: false }), /No API key found for worker-test/);
    observer.mock.restore();
    childPrompt = appended.flat().join('\n');
    assert.match(childPrompt, /You are a \*\*Task subagent\*\*/);
    assert.match(childPrompt, /## Approval Bar/);
    assert.match(childPrompt, /# No inline imports/);
    assert.match(childPrompt, /typescript-exhaustive-switch: In switch statements/);
    const first = await call('Task', { prompt: 'first', model: 'worker-test/deterministic', run_in_background: false });
    const data = JSON.parse(first.content.find(block => block.type === 'text')!.text);
    assert.equal(data.status, 'settled');
    assert.equal(data.output, 'users=1');
    assert.equal(first.usage?.totalTokens, 5);
    const second = await call('Task', { prompt: 'second', resume: data.task_id, run_in_background: false });
    assert.match(JSON.stringify(second.content), /users=2/);
    await session.extensionRunner.emit({ type: 'session_start', reason: 'reload' });
    const restored = await call('Task', { prompt: 'third', resume: data.task_id, run_in_background: false });
    assert.match(JSON.stringify(restored.content), /users=3/);
    await assert.rejects(call('Task', { prompt: 'FAIL', model: 'worker-test/deterministic', run_in_background: false }), /scripted failure/);
    const running = await call('Task', { prompt: 'WAIT', model: 'worker-test/deterministic' });
    const runningId = JSON.parse(running.content.find(block => block.type === 'text')!.text).task_id;
    const completed = await call('TaskOutput', { task_id: runningId, block: true });
    assert.match(JSON.stringify(completed.content), /settled/);
    assert.equal(completed.usage?.totalTokens, 5);
    assert.equal((await call('TaskOutput', { task_id: runningId })).usage, undefined);
    await session.waitForIdle();
    const background = await call('Task', { prompt: 'WAIT', model: 'worker-test/deterministic' });
    const task = JSON.parse(background.content.find(block => block.type === 'text')!.text);
    assert.equal(task.status, 'running');
    const stopped = await call('TaskStop', { task_id: task.task_id });
    assert.match(JSON.stringify(stopped.content), /interrupted/);
    await call('Task', { prompt: 'NEST_ROOT', model: 'worker-test/deterministic', run_in_background: false });
    let audit = await readFile(join(dir, 'audit.txt'), 'utf8');
    assert.match(audit, /parent-finished/);
    assert.match(audit, /grandchild-start/);
    assert.match(audit, /grandchild-aborted/);
    assert.doesNotMatch(audit, /grandchild-finished/);
    const afterTerminal = audit;
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.equal(await readFile(join(dir, 'audit.txt'), 'utf8'), afterTerminal, 'terminal child cannot leave delayed writes or wake new turns');
    await writeFile(join(dir, 'audit.txt'), '');
    const nestedRun = await call('Task', { prompt: 'NEST_STOP', model: 'worker-test/deterministic' });
    const nestedId = JSON.parse(nestedRun.content.find(block => block.type === 'text')!.text).task_id;
    for (let attempt = 0; attempt < 100; attempt++) {
      audit = await readFile(join(dir, 'audit.txt'), 'utf8');
      if (audit.includes('grandchild-start')) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.match(audit, /grandchild-start/);
    await call('TaskStop', { task_id: nestedId });
    const afterStop = await readFile(join(dir, 'audit.txt'), 'utf8');
    assert.match(afterStop, /grandchild-aborted/);
    assert.doesNotMatch(afterStop, /grandchild-finished/);
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.equal(await readFile(join(dir, 'audit.txt'), 'utf8'), afterStop, 'TaskStop drains grandchildren before returning');

  } finally {
    if (session) { await session.abort(); await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); }
    if (priorDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = priorDir;
    await rm(dir, { recursive: true, force: true });
  }
});
