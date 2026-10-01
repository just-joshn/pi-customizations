export type DetachedActivity = { kind: 'idle' } | { kind: 'accepted' | 'running' | 'settled'; invocation: string };
export function nextActivity(activity: DetachedActivity, event: unknown): DetachedActivity;
