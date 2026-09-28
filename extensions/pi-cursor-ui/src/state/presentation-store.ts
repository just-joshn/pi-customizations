import { type PresentationState, type RunningToolActivity, toolTarget } from './presentation-state.ts';

export interface PresentationStore {
  getSnapshot(): PresentationState;
  setAgentRunning(startedAt: number): void;
  setAgentIdle(): void;
  startTool(input: { toolCallId: string; toolName: string; args: unknown; startedAt: number }): void;
  finishTool(input: { toolCallId: string; toolName: string; isError: boolean; finishedAt: number }): void;
  reset(): void;
  notifyChanged(): void;
  subscribe(listener: () => void): () => void;
}

const EDIT_TOOLS = new Set(['edit', 'write']);

function idleState(): PresentationState {
  return { phase: { kind: 'idle' }, activeTools: new Map(), editedFiles: new Set() };
}

export function createPresentationStore(): PresentationStore {
  let snapshot: PresentationState = idleState();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const publish = (next: PresentationState): void => {
    snapshot = next;
    notify();
  };

  return {
    getSnapshot: () => snapshot,

    setAgentRunning(startedAt) {
      publish({ ...snapshot, phase: { kind: 'running', startedAt } });
    },

    setAgentIdle() {
      if (snapshot.phase.kind === 'idle') return;
      publish({ ...snapshot, phase: { kind: 'idle' } });
    },

    startTool(input) {
      const activity: RunningToolActivity = {
        kind: 'running',
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        startedAt: input.startedAt,
        args: input.args,
      };
      const activeTools = new Map(snapshot.activeTools);
      activeTools.set(input.toolCallId, activity);
      publish({ ...snapshot, activeTools });
    },

    finishTool(input) {
      const activity = snapshot.activeTools.get(input.toolCallId);
      if (activity === undefined) return;
      const activeTools = new Map(snapshot.activeTools);
      activeTools.delete(input.toolCallId);

      const target = input.isError ? undefined : toolTarget(activity.args);
      if (target !== undefined && EDIT_TOOLS.has(input.toolName) && !snapshot.editedFiles.has(target)) {
        const editedFiles = new Set(snapshot.editedFiles);
        editedFiles.add(target);
        publish({ ...snapshot, activeTools, editedFiles });
        return;
      }
      publish({ ...snapshot, activeTools });
    },

    reset() {
      publish(idleState());
    },

    notifyChanged: notify,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
