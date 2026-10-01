import { isAbsolute } from 'node:path';

import { Type } from 'typebox';
import { Check } from 'typebox/value';

export const ExecutorSchema = Type.Object({
  id: Type.String({ minLength: 1, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$' }),
  transport: Type.Union([Type.Literal('lima'), Type.Literal('ssh')]),
  target: Type.String({ minLength: 1, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$' }),
  packageRoot: Type.String({ minLength: 1 }),
  repository: Type.String({ minLength: 1 }),
  localRepository: Type.String({ minLength: 1 }),
  agentDir: Type.String({ minLength: 1 }),
  machineId: Type.String({ minLength: 1 }),
  isolation: Type.Literal('vm'),
  knownHosts: Type.Optional(Type.String({ minLength: 1 })),
  extensions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

export function parseExecutor(input) {
  if (!Check(ExecutorSchema, input)) throw new Error('Invalid remote executor. Supply a configured VM, machine identity, and absolute paths.');
  for (const path of [input.packageRoot, input.repository, input.localRepository, input.agentDir, ...(input.knownHosts ? [input.knownHosts] : []), ...(input.extensions ?? [])]) {
    if (!isAbsolute(path) || /[\x00-\x1f]/.test(path)) throw new Error('Invalid remote executor. Paths must be absolute and contain no control characters.');
  }
  if (input.transport === 'ssh' && !input.knownHosts) throw new Error('SSH executor requires knownHosts with the independently verified target host key.');
  return structuredClone(input);
}
