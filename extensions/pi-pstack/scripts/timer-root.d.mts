import type { DetachedRpcHandle, startDetachedRpc } from './detached-rpc-client.mjs';

type TimerRoot = { rpcDirectory: string; sessionFile: string; runId: string; childPid: number; model?: { provider: string; id: string } };
type TimerLaunch = Omit<Parameters<typeof startDetachedRpc>[0], 'directory'> & { expectedModel?: { provider: string; id: string } };
export function openTimerRoot(directory: string, launch: TimerLaunch): Promise<{ handle: DetachedRpcHandle; root: TimerRoot }>;
