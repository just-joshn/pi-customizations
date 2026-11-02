export const title = 'Cross-process OAuth refresh token claims';

export function state(vars: Record<string, any>) {
  const claims = Object.entries(vars.exists ?? {})
    .filter(([, held]) => held)
    .map(([gen]) => gen);
  return {
    Process1: vars.pc?.p1 ?? 'idle',
    Process2: vars.pc?.p2 ?? 'idle',
    Process3: vars.pc?.p3 ?? 'idle',
    Claims: claims.length === 0 ? 'none' : claims.join(', '),
  };
}

export function step(action: string, _from: Record<string, any>, _to: Record<string, any>) {
  switch (action) {
    case 'Reuse':
      return 'reads shared credential';
    case 'List':
      return 'lists claims';
    case 'Stat':
      return 'checks latest claim mtime';
    case 'Create':
      return "creates claim with 'wx'";
    case 'Wait':
      return 'waits or gives up';
    case 'CallRefresh':
      return 'calls oauth.refresh()';
    case 'RefreshFails':
      return 'refresh fails';
    case 'Release':
      return 'deletes own claim';
    case 'Publish':
      return 'writes shared credential';
    case 'Crash':
      return 'process crashes';
    case 'Done':
      return 'complete';
    default:
      return action;
  }
}
