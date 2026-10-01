import type { RpcCommand, RpcResponse } from '@earendil-works/pi-coding-agent';

export type DetachedRpcHandle = {
  readonly directory: string;
  status(): Promise<'starting' | 'ready' | 'exited' | 'failed'>;
  send(command: RpcCommand): Promise<RpcResponse>;
  close(): Promise<void>;
};

export function openDetachedRpc(directory: string): DetachedRpcHandle;
export function startDetachedRpc(config: { directory: string; cwd: string; agentDir: string; args: string[] }): Promise<DetachedRpcHandle>;
