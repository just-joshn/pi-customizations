import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { configuredExecutor, type RemoteExecutor } from './remote-executors.ts';
import { openRemoteRpc, remoteCall } from './remote-worker-transport.ts';
import { availableInEnvironment } from './resource-environment.ts';
import type { TaskParameters, TaskRecord } from './worker-records.ts';
import type { prepareWorkerSession } from './worker-support.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
type Prepared = Awaited<ReturnType<typeof prepareWorkerSession>>;
const StartedSchema = Type.Object({
  directory: Type.String(),
  cwd: Type.String(),
  sha: Type.String(),
  executorId: Type.String(),
  machineId: Type.String(),
  hostname: Type.String(),
  isolation: Type.Literal('vm'),
  virtualization: Type.String({ minLength: 1 }),
  bootId: Type.String({ minLength: 1 }),
  sessionFile: Type.String(),
  sessionId: Type.String(),
  model: Type.Object({ provider: Type.String(), id: Type.String() }),
  thinkingLevel: Type.String(),
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    return (await run('git', ['-C', cwd, ...args])).stdout.trim();
  } catch (error) {
    throw new Error(`Remote Task could not resolve its committed checkout: ${String(error)}`);
  }
}

export async function resolveRemotePlacement(cwd: string, params: TaskParameters, prior?: TaskRecord) {
  if (prior?.detached && !prior.detached.remote) throw new Error('A legacy local detached task cannot resume as a remote VM. Start a new cloud Task.');
  const saved = prior?.detached?.remote;
  if (saved && params.remote_executor && params.remote_executor !== saved.executor.id) throw new Error('Resume must preserve the remote executor.');
  const executor = saved?.executor ?? (await configuredExecutor(cwd, params.remote_executor));
  const repository = await git(cwd, 'rev-parse', '--show-toplevel');
  if ((await realpath(executor.localRepository)) !== (await realpath(repository))) throw new Error('The configured executor does not mirror this Git repository.');
  const branch = params.cloud_base_branch;
  const sha = saved && !branch ? saved.sha : await resolveSha(repository, branch);
  if (saved && sha !== saved.sha) throw new Error('Resume must preserve the remote checkout SHA.');
  return { executor, sha, subdirectory: relative(repository, cwd) || '.' };
}

async function resolveSha(repository: string, branch?: string): Promise<string> {
  if (!branch) return git(repository, 'rev-parse', 'HEAD');
  for (const candidate of [branch, `origin/${branch}`]) {
    const sha = await git(repository, 'rev-parse', '--verify', '--end-of-options', `${candidate}^{commit}`).catch(() => '');
    if (sha) return sha;
  }
  throw new Error(`cloud_base_branch ${branch} does not resolve locally or on origin. Push or fetch it first.`);
}

function guestResource(path: string, executor: RemoteExecutor): string | undefined {
  const suffix = relative(root, path);
  return suffix === '..' || suffix.startsWith('../') || isAbsolute(suffix) ? undefined : join(executor.packageRoot, suffix);
}

export function remoteWorkerArguments(prepared: Pick<Prepared, 'selected' | 'loader' | 'readonly' | 'settingsManager'>, executor: RemoteExecutor): string[] {
  const resources = [
    ...prepared.loader
      .getSkills()
      .skills.filter((item) => guestResource(item.filePath, executor) !== undefined && availableInEnvironment(item.filePath, 'cloud'))
      .flatMap((item) => {
        const path = guestResource(item.filePath, executor);
        return path ? ['--skill', path] : [];
      }),
    ...prepared.loader
      .getPrompts()
      .prompts.filter((item) => guestResource(item.filePath, executor) !== undefined && availableInEnvironment(item.filePath, 'cloud'))
      .flatMap((item) => {
        const path = guestResource(item.filePath, executor);
        return path ? ['--prompt-template', path] : [];
      }),
  ];
  return [
    prepared.settingsManager.isProjectTrusted() ? '--approve' : '--no-approve',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--provider',
    prepared.selected.model.provider,
    '--model',
    prepared.selected.model.id,
    '--thinking',
    prepared.selected.thinkingLevel,
    ...[...new Set([join(executor.packageRoot, 'src/index.ts'), ...(executor.extensions ?? [])])].flatMap((path) => ['-e', path]),
    ...resources,
    ...(prepared.readonly ? ['--tools', 'read,grep,find,ls'] : []),
  ];
}

export async function startRemoteWorker(id: string, prepared: Prepared, placement: Awaited<ReturnType<typeof resolveRemotePlacement>>, prior?: TaskRecord) {
  const { executor, sha, subdirectory } = placement;
  const response = await remoteCall(executor, {
    operation: 'start',
    taskId: id,
    sha,
    subdirectory,
    args: remoteWorkerArguments(prepared, executor),
    systemPrompt: prepared.loader.getAppendSystemPrompt().join('\n\n').replaceAll(root, executor.packageRoot),
    ...(prior ? { sessionFile: prior.sessionFile } : {}),
  });
  if (!Check(StartedSchema, response)) throw new Error('Invalid remote worker placement receipt.');
  const handle = openRemoteRpc(executor, id, response.directory);
  try {
    if (response.machineId !== executor.machineId || response.executorId !== executor.id || response.sha !== sha) throw new Error('Remote worker placement did not match the requested machine and SHA.');
    if (response.model.provider !== prepared.selected.model.provider || response.model.id !== prepared.selected.model.id || response.thinkingLevel !== prepared.selected.thinkingLevel)
      throw new Error('Cloud worker did not select the requested model and thinking level.');
    return { handle, response, remote: { executor, machineId: response.machineId, hostname: response.hostname, virtualization: response.virtualization, bootId: response.bootId, sha, localCwd: prepared.cwd } };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
