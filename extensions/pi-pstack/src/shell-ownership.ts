import type { ShellRuntime } from './shell-runtime.ts';

export const shellHandoffEvent = 'pstack:shell-handoff';

export type ShellHandoff = Readonly<{ shells: ShellRuntime; claim: () => boolean; claimed: () => boolean }>;
export type ShellRole = Readonly<{ child: boolean; endsWithFinalResponse: boolean }>;

export function shellHandoff(shells: ShellRuntime): ShellHandoff {
  let owned = false;
  return {
    shells,
    claim: () => {
      if (owned) return false;
      owned = true;
      return true;
    },
    claimed: () => owned,
  };
}

export function asShellHandoff(payload: unknown): ShellHandoff | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const candidate = payload as Partial<ShellHandoff>;
  return typeof candidate.claim === 'function' && typeof candidate.claimed === 'function' && candidate.shells !== undefined ? (candidate as ShellHandoff) : undefined;
}

type Entry = { type: string; customType?: string; data?: unknown };

export function shellRole(branch: readonly Entry[]): ShellRole {
  const latest = (customType: string) => branch.findLast((entry) => entry.type === 'custom' && entry.customType === customType);
  return { child: latest('pstack-agent-identity') !== undefined, endsWithFinalResponse: latest('pstack-agent-foreground')?.data === true };
}
