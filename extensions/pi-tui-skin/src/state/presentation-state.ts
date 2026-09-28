/** Presentation-only state for the Reference-style skin. Nothing here is persisted. */
export type AgentPhase = { kind: 'idle' } | { kind: 'running'; startedAt: number };

export type RunningToolActivity = {
  kind: 'running';
  toolCallId: string;
  toolName: string;
  startedAt: number;
  args: unknown;
};

export type PresentationState = {
  phase: AgentPhase;
  activeTools: ReadonlyMap<string, RunningToolActivity>;
  editedFiles: ReadonlySet<string>;
};

/** Read the display target from untrusted tool arguments. Never throws. */
export function toolTarget(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined;
  const keys = ['path', 'pattern', 'command'];
  for (const key of keys) {
    const value: unknown = Reflect.get(args, key);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
