import type { RpcCommand, RpcResponse } from '@earendil-works/pi-coding-agent';
import type { DetachedActivity } from './detached-rpc-protocol.mjs';

export type DetachedRpcHandle = {
  readonly directory: string;
  status(): Promise<'starting' | 'ready' | 'exited' | 'failed'>;
  activity(): Promise<DetachedActivity>;
  snapshot(): Promise<{ invocation: string; entries: unknown[]; leafId: string | null; error?: string } | undefined>;
  info(): Promise<{ kind: 'starting'; pid: number } | { kind: 'ready'; pid: number; childPid: number } | { kind: 'exited'; pid: number; code: number | null } | { kind: 'failed'; pid: number; error: string }>;
  send(command: RpcCommand, id?: string): Promise<RpcResponse>;
  close(): Promise<void>;
};

export function openDetachedRpc(directory: string): DetachedRpcHandle;
export function startDetachedRpc(config: {
  directory: string;
  cwd: string;
  agentDir: string;
  args: string[];
  headless?: boolean;
  closeAfterSettle?: boolean;
  ownerId?: string;
  filesystem?: { denied: string[]; allowed: string[] };
}): Promise<DetachedRpcHandle>;
