import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { type DetachedRpcHandle, openDetachedRpc, startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { taskOutcome } from './task-outcome.ts';
import type { TaskParameters, TaskRecord } from './worker-records.ts';
import { prepareWorkerSession } from './worker-support.ts';

export function cloudWorkerArguments({ dir, selected, loader, readonly }: Awaited<ReturnType<typeof prepareWorkerSession>>, systemFile: string, prior?: TaskRecord): string[] {
  return [
    '--approve',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--session-dir',
    dir,
    ...(prior ? ['--session', prior.sessionFile] : []),
    '--provider',
    selected.model.provider,
    '--model',
    selected.model.id,
    '--thinking',
    selected.thinkingLevel,
    '--append-system-prompt',
    systemFile,
    ...loader.getExtensions().extensions.flatMap((extension) => ['-e', extension.resolvedPath]),
    ...loader.getSkills().skills.flatMap((skill) => ['--skill', skill.filePath]),
    ...loader.getPrompts().prompts.flatMap((prompt) => ['--prompt-template', prompt.filePath]),
    ...(readonly ? ['--tools', 'read,grep,find,ls'] : []),
  ];
}

export async function openCloudWorker(options: { id: string; params: TaskParameters; prior: TaskRecord | undefined; ctx: ExtensionContext }) {
  const { id, prior } = options;
  const prepared = await prepareWorkerSession(options, 'detached');
  const { cwd, persona, readonly, selected, loader, dir } = prepared;
  const systemFile = join(dir, `${id}.system.txt`);
  await writeFile(systemFile, loader.getAppendSystemPrompt().join('\n\n'), { mode: 0o600 });
  const args = cloudWorkerArguments(prepared, systemFile, prior);
  const handle = await startDetachedRpc({ directory: dir, cwd, agentDir: getAgentDir(), args, headless: true, closeAfterSettle: true, ownerId: id });
  try {
    const state = await handle.send({ type: 'get_state' });
    if (!state.success || state.command !== 'get_state' || !state.data.sessionFile) throw new Error('Cloud worker did not provide a durable session.');
    if (state.data.model?.provider !== selected.model.provider || state.data.model.id !== selected.model.id || state.data.thinkingLevel !== selected.thinkingLevel)
      throw new Error('Cloud worker did not select the requested model and thinking level.');
    const entries = await handle.send({ type: 'get_entries' });
    if (!entries.success || entries.command !== 'get_entries') throw new Error('Cloud worker did not provide its entry cursor.');
    const record: TaskRecord = {
      id,
      persona,
      cwd,
      readonly,
      modelReference: `${selected.model.provider}/${selected.model.id}:${selected.thinkingLevel}`,
      sessionFile: state.data.sessionFile,
      outputFile: join(dir, `${id}.output.txt`),
      status: 'running',
      output: '',
      detached: { directory: handle.directory, invocation: randomUUID(), entryCursor: entries.data.entries.at(-1)?.id ?? null },
    };
    return { handle, record };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readCloudOutcome(record: TaskRecord) {
  if (!record.detached) throw new Error('Task is not detached.');
  const handle = openDetachedRpc(record.detached.directory);
  const state = await handle.info();
  if (state.kind === 'ready' || state.kind === 'starting') return undefined;
  const snapshot = await handle.snapshot();
  if (snapshot) {
    if (snapshot.invocation !== record.detached.invocation) throw new Error('Cloud task invocation does not match its saved snapshot.');
    const outcome = taskOutcome(snapshot.entries, snapshot.leafId);
    const error = snapshot.error ?? (state.kind === 'failed' ? state.error : state.kind === 'exited' && state.code !== 0 ? `Cloud worker exited with code ${state.code}.` : undefined);
    return error ? { ...outcome, status: 'failed' as const, output: error } : outcome;
  }
  return { ...taskOutcome([], null), status: state.kind === 'failed' ? ('failed' as const) : ('interrupted' as const), output: state.kind === 'failed' ? state.error : 'Cloud worker exited without a completion snapshot.' };
}

export function cloudControl(handle: DetachedRpcHandle) {
  const controller = new AbortController();
  let stopping: Promise<void> | undefined;
  let failure: string | undefined;
  return {
    signal: controller.signal,
    stopped: () => stopping !== undefined,
    disconnect: () => controller.abort(),
    stop() {
      stopping ??= stopCloudWorker(handle).catch((error) => {
        failure = String(error);
      });
    },
    async drain() {
      await stopping;
      return failure ? [failure] : [];
    },
  };
}

export async function stopCloudWorker(handle: DetachedRpcHandle): Promise<void> {
  if (await handle.snapshot()) return;
  const state = await handle.info();
  if (state.kind === 'exited' || state.kind === 'failed') return;
  for (const command of ['clear_queue', 'abort_retry', 'abort'] as const) {
    const response = await handle.send({ type: command });
    if (!response.success) throw new Error(response.error);
  }
  await handle.close();
}
