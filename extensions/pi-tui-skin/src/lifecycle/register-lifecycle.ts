/** Every handler is read-only and returns no value, so nothing here can block a tool or change agent state. */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { PresentationStore } from '../state/presentation-store.ts';

export type LifecycleDependencies = {
  store: PresentationStore;
  onSessionStart(ctx: ExtensionContext): void;
  onSessionShutdown(ctx: ExtensionContext): void;
};

export function registerLifecycle(pi: ExtensionAPI, deps: LifecycleDependencies): void {
  pi.on('session_start', (_event, ctx) => {
    deps.onSessionStart(ctx);
  });

  pi.on('session_shutdown', (_event, ctx) => {
    deps.onSessionShutdown(ctx);
  });

  pi.on('agent_start', () => {
    deps.store.setAgentRunning(Date.now());
  });

  pi.on('agent_settled', () => {
    deps.store.setAgentIdle();
  });

  pi.on('tool_execution_start', (event) => {
    deps.store.startTool({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
      startedAt: Date.now(),
    });
  });

  pi.on('tool_execution_end', (event) => {
    deps.store.finishTool({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
      finishedAt: Date.now(),
    });
  });

  pi.on('model_select', () => {
    deps.store.notifyChanged();
  });

  pi.on('thinking_level_select', () => {
    deps.store.notifyChanged();
  });
}
