import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { RpcCommand, RpcResponse } from '@earendil-works/pi-coding-agent';
import { type Static, type TSchema, Type } from 'typebox';
import { Check } from 'typebox/value';
import type { DetachedRpcHandle } from '../scripts/detached-rpc-client.mjs';
import { type RemoteExecutor, remoteArguments } from './remote-executors.ts';

type RemoteRequest = {
  operation: 'start' | 'send' | 'info' | 'activity' | 'snapshot' | 'close';
  taskId: string;
  directory?: string;
  sha?: string;
  subdirectory?: string;
  systemPrompt?: string;
  args?: string[];
  command?: RpcCommand;
  invocation?: string;
  sessionFile?: string;
};
const ReplySchema = Type.Union([Type.Object({ success: Type.Literal(true), result: Type.Unknown() }), Type.Object({ success: Type.Literal(false), error: Type.String() })]);
const StatusSchema = Type.Union([
  Type.Object({ kind: Type.Literal('starting'), pid: Type.Integer() }),
  Type.Object({ kind: Type.Literal('ready'), pid: Type.Integer(), childPid: Type.Integer() }),
  Type.Object({ kind: Type.Literal('exited'), pid: Type.Integer(), code: Type.Union([Type.Integer(), Type.Null()]) }),
  Type.Object({ kind: Type.Literal('failed'), pid: Type.Integer(), error: Type.String() }),
]);
const ActivitySchema = Type.Union([Type.Object({ kind: Type.Literal('idle') }), Type.Object({ kind: Type.Union([Type.Literal('accepted'), Type.Literal('running'), Type.Literal('settled')]), invocation: Type.String() })]);
const SnapshotSchema = Type.Object({ invocation: Type.String(), entries: Type.Array(Type.Unknown()), leafId: Type.Union([Type.String(), Type.Null()]), error: Type.Optional(Type.String()) });
const ResponseSchema = Type.Union([
  Type.Object({ type: Type.Literal('response'), command: Type.String(), success: Type.Literal(true), data: Type.Optional(Type.Unknown()) }),
  Type.Object({ type: Type.Literal('response'), command: Type.String(), success: Type.Literal(false), error: Type.String() }),
]);

function validated<T extends TSchema>(schema: T, input: unknown): Static<T> {
  if (!Check(schema, input)) throw new Error('Invalid remote RPC response.');
  return input;
}

export async function remoteCall(executor: RemoteExecutor, request: RemoteRequest): Promise<unknown> {
  const payload = JSON.stringify({ ...request, executor });
  if (Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new Error('Remote request exceeds the input limit.');
  const { executable, args } = remoteArguments(executor);
  const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'TMPDIR', 'SSH_AUTH_SOCK', 'LIMA_HOME'].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])));
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { env, timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      try {
        const reply = validated(ReplySchema, JSON.parse(stdout));
        if (!reply.success) throw new Error(reply.error);
        if (error) throw error;
        resolve(reply.result);
      } catch (failure) {
        reject(
          new Error(
            error?.killed
              ? `Remote transport timed out; invocation ${request.invocation ?? request.taskId} may still be running. Inspect its status before retrying.`
              : failure instanceof SyntaxError
                ? 'Invalid remote RPC JSON response.'
                : String(failure),
          ),
        );
      }
    });
    child.stdin?.on('error', reject);
    child.stdin?.end(payload);
  });
}

export function openRemoteRpc(executor: RemoteExecutor, taskId: string, directory: string): DetachedRpcHandle {
  const call = (operation: RemoteRequest['operation']) => remoteCall(executor, { operation, taskId, directory });
  return {
    directory,
    info: async () => validated(StatusSchema, await call('info')),
    status: async () => validated(StatusSchema, await call('info')).kind,
    activity: async () => validated(ActivitySchema, await call('activity')),
    snapshot: async () => {
      const value = await call('snapshot');
      return value === null ? undefined : validated(SnapshotSchema, value);
    },
    send: async (command, invocation = randomUUID()) => validated(ResponseSchema, await remoteCall(executor, { operation: 'send', taskId, directory, command, invocation })) as RpcResponse,
    close: async () => {
      await call('close');
    },
  };
}
