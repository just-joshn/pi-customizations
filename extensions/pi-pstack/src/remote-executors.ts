import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { Static } from 'typebox';

export { ExecutorSchema, parseExecutor } from '../scripts/remote-executor-schema.mjs';
import { ExecutorSchema, parseExecutor } from '../scripts/remote-executor-schema.mjs';
export type RemoteExecutor = Static<typeof ExecutorSchema>;

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function remoteArguments(executor: RemoteExecutor): { executable: string; args: string[] } {
  const command = ['env', '-i', `HOME=${executor.agentDir}`, 'PATH=/usr/local/bin:/usr/bin:/bin', 'node', join(executor.packageRoot, 'scripts/remote-rpc.mjs')];
  return executor.transport === 'lima'
    ? { executable: 'limactl', args: ['shell', '--workdir=/tmp', executor.target, ...command] }
    : { executable: 'ssh', args: ['-oForwardAgent=no', '-oClearAllForwardings=yes', '-oPermitLocalCommand=no', '-oBatchMode=yes', '-oStrictHostKeyChecking=yes', `-oUserKnownHostsFile=${executor.knownHosts}`, '--', executor.target, command.map(quote).join(' ')] };
}

export async function configuredExecutor(cwd: string, requested?: string): Promise<RemoteExecutor> {
  const path = process.env.PI_PSTACK_EXECUTORS ?? join(getAgentDir(), 'pstack/executors.json');
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cloud Tasks require a configured isolated remote executor at ${path}. No local fallback is permitted. ${String(error)}`);
  }
  if (!Array.isArray(data)) throw new Error('Remote executor configuration must be an array.');
  const executors = await Promise.all(data.map(async (input) => {
    const executor = parseExecutor(input);
    return { ...executor, localRepository: await realpath(executor.localRepository) };
  }));
  if (new Set(executors.map((executor) => executor.id)).size !== executors.length) throw new Error('Duplicate remote executor identity.');
  if (new Set(executors.map((executor) => executor.machineId)).size !== executors.length) throw new Error('Duplicate remote machine identity. Independent lanes require different actual machines.');
  const workspace = await realpath(cwd);
  const matches = executors.filter((executor) => (!requested || executor.id === requested) && containsWorkspace(executor.localRepository, workspace));
  if (matches.length !== 1) throw new Error('Choose exactly one remote executor for this repository. Configure its localRepository and explicit executor ID.');
  return matches[0];
}

function containsWorkspace(repository: string, workspace: string): boolean {
  const path = relative(repository, workspace);
  return path !== '..' && !path.startsWith('../') && !isAbsolute(path);
}
