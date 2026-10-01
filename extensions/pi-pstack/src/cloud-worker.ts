import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type DetachedRpcHandle, openDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { resolveRemotePlacement, startRemoteWorker } from './remote-worker.ts';
import { openRemoteRpc } from './remote-worker-transport.ts';
import { availableInEnvironment } from './resource-environment.ts';
import { publishTask } from './task-discovery.ts';
import { taskOutcome } from './task-outcome.ts';
import type { TaskParameters, TaskRecord } from './worker-records.ts';
import { prepareWorkerSession } from './worker-support.ts';

export function cloudWorkerArguments({ dir, selected, loader, readonly }: Pick<Awaited<ReturnType<typeof prepareWorkerSession>>, 'dir' | 'selected' | 'loader' | 'readonly'>, systemFile: string, prior?: TaskRecord): string[] {
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
    ...loader
      .getSkills()
      .skills.filter((skill) => availableInEnvironment(skill.filePath, 'cloud'))
      .flatMap((skill) => ['--skill', skill.filePath]),
    ...loader
      .getPrompts()
      .prompts.filter((prompt) => availableInEnvironment(prompt.filePath, 'cloud'))
      .flatMap((prompt) => ['--prompt-template', prompt.filePath]),
    ...(readonly ? ['--tools', 'read,grep,find,ls'] : []),
  ];
}

export async function openCloudWorker(options: { id: string; params: TaskParameters; prior: TaskRecord | undefined; ctx: ExtensionContext }) {
  const { id, prior } = options;
  const localCwd = resolve(options.ctx.cwd, options.params.cwd ?? prior?.detached?.remote?.localCwd ?? options.ctx.cwd);
  const placement = await resolveRemotePlacement(localCwd, options.params, prior);
  const prepared = await prepareWorkerSession(options, 'remote');
  if (prior?.detached) {
    const previous = openCloudHandle(prior);
    const state = await previous.info();
    if (state.kind === 'ready' || state.kind === 'starting') throw new Error('Remote task still owns a live writer. Use TaskOutput or TaskStop first.');
    await previous.close();
  }
  const { persona, readonly, selected, dir } = prepared;
  const { handle, response, remote } = await startRemoteWorker(id, prepared, placement, prior);
  try {
    const entries = await handle.send({ type: 'get_entries' });
    if (!entries.success || entries.command !== 'get_entries') throw new Error('Cloud worker did not provide its entry cursor.');
    const record: TaskRecord = {
      id,
      persona,
      cwd: response.cwd,
      readonly,
      modelReference: `${selected.model.provider}/${selected.model.id}:${selected.thinkingLevel}`,
      sessionFile: response.sessionFile,
      outputFile: join(dir, `${id}.output.txt`),
      status: 'running',
      output: '',
      detached: { directory: handle.directory, invocation: randomUUID(), entryCursor: entries.data.entries.at(-1)?.id ?? null, remote },
    };
    await publishTask(record, prepared.cwd, options.params.cloud_base_branch);
    return { handle, record };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export function openCloudHandle(record: TaskRecord): DetachedRpcHandle {
  if (!record.detached) throw new Error('Task is not detached.');
  const { directory, remote } = record.detached;
  return remote ? openRemoteRpc(remote.executor, record.id, directory) : openDetachedRpc(directory);
}

export async function readCloudOutcome(record: TaskRecord) {
  if (!record.detached) throw new Error('Task is not detached.');
  const handle = openCloudHandle(record);
  const state = await handle.info();
  if (state.kind === 'ready' || state.kind === 'starting') return undefined;
  const snapshot = await handle.snapshot();
  if (snapshot) {
    if (snapshot.invocation !== record.detached.invocation) throw new Error('Cloud task invocation does not match its saved snapshot.');
    const outcome = taskOutcome(snapshot.entries, snapshot.leafId);
    if (record.detached.remote) await handle.close();
    const error = snapshot.error ?? (state.kind === 'failed' ? state.error : state.kind === 'exited' && state.code !== 0 ? `Cloud worker exited with code ${state.code}.` : undefined);
    return error ? { ...outcome, status: 'failed' as const, output: error } : outcome;
  }
  if (record.detached.remote) await handle.close();
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
