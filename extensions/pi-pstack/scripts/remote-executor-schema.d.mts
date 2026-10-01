import type { TUnsafe } from 'typebox';
export type RemoteExecutor = {
  id: string;
  transport: 'lima' | 'ssh';
  target: string;
  packageRoot: string;
  repository: string;
  localRepository: string;
  agentDir: string;
  machineId: string;
  isolation: 'vm';
  knownHosts?: string;
  extensions?: string[];
};
export const ExecutorSchema: TUnsafe<RemoteExecutor>;
export function parseExecutor(input: unknown): RemoteExecutor;
