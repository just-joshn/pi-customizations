export const title = 'Concurrent OAuth Refresh File Lock';

export function state(vars: Record<string, any>) {
  return {
    Process1: vars.pc?.p1 ?? 'idle',
    Process2: vars.pc?.p2 ?? 'idle',
    Lock: vars.lockState === 'held' ? `Held by ${vars.lockHolder}` : 'Free',
  };
}

export function step(action: string, _from: Record<string, any>, _to: Record<string, any>) {
  switch (action) {
    case 'TryAcquire':
      return 'attempts mkdir';
    case 'CheckStale':
      return 'EEXIST: checks mtime';
    case 'StealLock':
      return 'removes stale lock';
    case 'ReadShared':
      return 'reads shared credential';
    case 'CallRefresh':
      return 'calls oauth.refresh()';
    case 'WriteShared':
      return 'writes shared JSON';
    case 'ReleaseLock':
      return 'releases lock directory';
    case 'Crash':
      return 'process crashes';
    case 'Done':
      return 'complete';
    default:
      return action;
  }
}
