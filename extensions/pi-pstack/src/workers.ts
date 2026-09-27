import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Usage } from '@earendil-works/pi-ai';
import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, type AgentSession, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { resolveModel } from './models.ts';
import { readPersona, readTeamKitRules } from './personas.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entryType = 'pstack-task';
const TaskRecordSchema = Type.Object({
  id: Type.String(), persona: Type.String(), cwd: Type.String(), readonly: Type.Boolean(),
  sessionFile: Type.String(), outputFile: Type.String(), modelReference: Type.Optional(Type.String()),
  status: Type.Union([Type.Literal('running'), Type.Literal('settled'), Type.Literal('failed'), Type.Literal('interrupted')]),
  output: Type.String(),
});
type TaskRecord = Static<typeof TaskRecordSchema>;
type Worker = { record: TaskRecord; session: AgentSession; completion: Promise<void>; stop: () => void; usage?: Usage; usageClaimed: boolean };

export function restoreTaskRecords(entries: ReadonlyArray<{ type: string; customType?: string; data?: unknown }>): Map<string, TaskRecord> {
  const records = new Map<string, TaskRecord>();
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === entryType && Check(TaskRecordSchema, entry.data)) {
      const record = entry.data;
      records.set(record.id, record.status === 'running' ? { ...record, status: 'interrupted', output: 'Parent session ended before completion. Resume this task to continue.' } : record);
    }
  }
  return records;
}

export function taskSummary(record: TaskRecord): string {
  return JSON.stringify({ task_id: record.id, status: record.status, output: record.output.slice(0, 12000), output_file: record.outputFile, transcript: record.sessionFile });
}

export function registerWorkers(pi: ExtensionAPI): void {
  let records = new Map<string, TaskRecord>();
  const workers = new Map<string, Worker>();
  const starting = new Set<string>();
  let generation = 0;
  const closing = new WeakMap<AgentSession, Promise<void>>();
  const close = (session: AgentSession): Promise<void> => {
    const pending = closing.get(session);
    if (pending) return pending;
    const operation = (async () => {
      try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); }
      finally { session.dispose(); }
    })();
    closing.set(session, operation);
    return operation;
  };
  const claimUsage = (worker: Worker | undefined) => {
    if (!worker || worker.usageClaimed || !worker.usage) return undefined;
    worker.usageClaimed = true;
    return worker.usage;
  };
  const stopAll = async () => {
    generation++;
    const current = [...workers.values()];
    workers.clear();
    for (const worker of current) worker.stop();
    await Promise.allSettled(current.map(async worker => { await worker.session.abort(); await worker.completion; await close(worker.session); }));
  };
  const restore = async (ctx: ExtensionContext) => {
    await stopAll();
    records = restoreTaskRecords(ctx.sessionManager.getBranch());
  };
  pi.on('session_start', async (_event, ctx) => restore(ctx));
  pi.on('session_tree', async (_event, ctx) => restore(ctx));
  pi.on('session_shutdown', stopAll);

  pi.registerTool({
    name: 'Task', label: 'Task', description: 'Start or resume a Pi subagent. Background runs return an ID and deliver completion. Cloud execution is unavailable. Readonly limits tools; it is not an OS sandbox. Models must resolve to configured Pi providers.',
    parameters: Type.Object({
      prompt: Type.String(), subagent_type: Type.Optional(Type.String()), model: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()), environment: Type.Optional(Type.Union([Type.Literal('local'), Type.Literal('cloud')])),
      readonly: Type.Optional(Type.Boolean()), run_in_background: Type.Optional(Type.Boolean()), resume: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal, _update, ctx) {
      if (params.environment === 'cloud') throw new Error('Cursor cloud execution is unavailable in Pi. Explicitly choose environment local only when local execution satisfies the task.');
      const prior = params.resume ? records.get(params.resume) : undefined;
      if (params.resume && !prior) throw new Error(`Unknown task in this branch: ${params.resume}`);
      const id = prior?.id ?? randomUUID();
      if (starting.has(id) || workers.get(id)?.record.status === 'running') throw new Error(`Task ${id} is running. Use TaskMessage to queue input.`);
      starting.add(id);
      const owner = generation;
      let session: AgentSession | undefined;
      try {
        const cwd = await realpath(resolve(ctx.cwd, params.cwd ?? prior?.cwd ?? ctx.cwd));
        const persona = params.subagent_type ?? prior?.persona ?? 'generalPurpose';
        const readonly = params.readonly ?? prior?.readonly ?? false;
        if (prior && (cwd !== prior.cwd || persona !== prior.persona || readonly !== prior.readonly)) throw new Error('Resume must preserve the task workspace, persona, and readonly policy.');
        const profile = await readPersona(persona);
        const selected = resolveModel(params.model ?? prior?.modelReference ?? profile.defaultModel, ctx);
        const rules = readonly ? await readTeamKitRules() : '';
        const loader = new DefaultResourceLoader({
          cwd, agentDir: getAgentDir(), noExtensions: readonly,
          additionalExtensionPaths: readonly ? [] : [join(root, 'src/index.ts')],
          additionalSkillPaths: [join(root, 'skills')],
          appendSystemPrompt: [profile.instructions, rules, `This is task ${id}. Task tools create nested agents. Drain every required child with TaskOutput before returning findings. Your final return closes this session and cancels unfinished descendants. Skill resources are in ${join(root, 'skills')}.`],
          extensionsOverride: result => ({ ...result, extensions: result.extensions.filter((extension, index, all) => all.findIndex(other => other.resolvedPath === extension.resolvedPath) === index) }),
        });
        await loader.reload();
        if (loader.getExtensions().errors.length) throw new Error(`Worker extension loading failed: ${loader.getExtensions().errors.map(error => error.error).join('; ')}`);
        const dir = join(ctx.sessionManager.getSessionDir(), 'pstack-workers', ctx.sessionManager.getSessionId());
        await mkdir(dir, { recursive: true });
        const manager = prior ? SessionManager.open(prior.sessionFile, dir, cwd) : SessionManager.create(cwd, dir);
        session = (await createAgentSession({ cwd, resourceLoader: loader, sessionManager: manager, ...selected, ...(readonly ? { tools: ['read', 'grep', 'find', 'ls'] } : {}) })).session;
        await session.bindExtensions({ mode: 'print' });
        if (generation !== owner || signal?.aborted) throw new Error('Task startup was cancelled.');
        const sessionFile = manager.getSessionFile();
        if (!sessionFile) throw new Error('Worker session did not provide a durable transcript path.');
        const record: TaskRecord = { id, persona, cwd, readonly, modelReference: `${selected.model.provider}/${selected.model.id}:${selected.thinkingLevel}`, sessionFile, outputFile: join(dir, `${id}.output.txt`), status: 'running', output: '' };
        const previous = workers.get(id);
        if (previous) await close(previous.session);
        records.set(id, record);
        pi.appendEntry(entryType, record);
        const child = session;
        let stopped = false;
        const stop = () => { stopped = true; void child.abort(); };
        const unsubscribe = child.subscribe(event => {
          if (stopped && event.type === 'agent_start') void child.abort();
        });
        signal?.addEventListener('abort', stop, { once: true });
        const initialCount = child.messages.length;
        const worker: Worker = { record, session: child, completion: Promise.resolve(), stop, usageClaimed: false };
        workers.set(id, worker);
        worker.completion = (async () => {
          let status: TaskRecord['status'] = 'settled';
          let output = '';
          try {
            await child.prompt(params.prompt);
            await child.waitForIdle();
            const last = child.messages.findLast(message => message.role === 'assistant');
            output = child.getLastAssistantText() ?? '';
            if (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
              status = last.stopReason === 'aborted' ? 'interrupted' : 'failed';
              output = last.errorMessage ?? output;
            }
          } catch (error) { status = 'failed'; output = error instanceof Error ? error.message : String(error); }
          finally { signal?.removeEventListener('abort', stop); unsubscribe(); }
          try { await close(child); }
          catch (error) { status = 'failed'; output += `\nWorker shutdown failed: ${String(error)}`; }
          if (stopped) status = 'interrupted';
          const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
          for (const message of child.messages.slice(initialCount)) {
            if ((message.role === 'assistant' || message.role === 'toolResult') && message.usage) {
              for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const) usage[key] += message.usage[key];
              for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) usage.cost[key] += message.usage.cost[key];
            }
          }
          worker.usage = usage;
          const finished = { ...record, status, output: output.slice(0, 12000) };
          try { await writeFile(finished.outputFile, output); }
          catch (error) { finished.status = 'failed'; finished.output += `\nCould not save full output: ${String(error)}`; }
          worker.record = finished;
          if (owner !== generation) return;
          records.set(id, finished);
          pi.appendEntry(entryType, finished);
          if (params.run_in_background !== false && !stopped) pi.sendMessage({ customType: 'pstack-task-completion', content: taskSummary(finished), display: true, details: finished }, { triggerTurn: true, deliverAs: 'followUp' });
        })();
        if (params.run_in_background === false) {
          await worker.completion;
          if (worker.record.status !== 'settled') throw new Error(taskSummary(worker.record));
        }
        return { content: [{ type: 'text', text: taskSummary(worker.record) }], details: worker.record, usage: claimUsage(worker) };
      } catch (error) { if (session) await close(session); throw error; }
      finally { starting.delete(id); }
    },
  });

  const taskId = Type.Object({ task_id: Type.String() });
  pi.registerTool({
    name: 'TaskOutput', label: 'Task output', description: 'Read task status and output. block waits for completion.',
    parameters: Type.Object({ task_id: Type.String(), block: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, signal) {
      const worker = workers.get(params.task_id);
      if (params.block && worker) {
        if (signal?.aborted) throw new Error('Wait cancelled.');
        await new Promise<void>((resolveWait, reject) => {
          const abort = () => reject(new Error('Wait cancelled.'));
          signal?.addEventListener('abort', abort, { once: true });
          worker.completion.then(resolveWait, reject).finally(() => signal?.removeEventListener('abort', abort));
        });
      }
      const record = records.get(params.task_id);
      if (!record) throw new Error(`Unknown task in this branch: ${params.task_id}`);
      return { content: [{ type: 'text', text: taskSummary(record) }], details: record, usage: claimUsage(worker) };
    },
  });
  pi.registerTool({
    name: 'TaskStop', label: 'Stop task', description: 'Abort a running child task.', parameters: taskId,
    async execute(_id, params) {
      const worker = workers.get(params.task_id);
      if (!worker) throw new Error(`No live task: ${params.task_id}`);
      worker.stop(); await worker.completion; await close(worker.session);
      return { content: [{ type: 'text', text: taskSummary(worker.record) }], details: worker.record, usage: claimUsage(worker) };
    },
  });
  pi.registerTool({
    name: 'TaskMessage', label: 'Message task', description: 'Queue a message to a running child. Resume completed children using Task.resume.',
    parameters: Type.Object({ task_id: Type.String(), message: Type.String(), mode: Type.Optional(Type.Union([Type.Literal('steer'), Type.Literal('followUp')])) }),
    async execute(_id, params) {
      const worker = workers.get(params.task_id);
      if (!worker || worker.record.status !== 'running') throw new Error('Task is not running. Use Task with resume.');
      if (params.mode === 'steer') await worker.session.steer(params.message);
      else await worker.session.followUp(params.message);
      return { content: [{ type: 'text', text: `Message queued for ${params.task_id}` }], details: { task_id: params.task_id } };
    },
  });
}
