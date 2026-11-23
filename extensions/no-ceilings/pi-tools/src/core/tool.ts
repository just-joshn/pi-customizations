import type { AgentToolResult, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import type { ToolFailure, ToolOutcome } from '../types.ts';
import { failureOutcome, toFailure } from './errors.ts';
import type { LayerContext } from './session.ts';

export interface ExecuteArgs<TParams, TDetails> {
  readonly toolCallId: string;
  readonly params: TParams;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TDetails> | undefined;
  readonly ctx: LayerContext;
  /** Path the call targeted, used to improve error reporting. */
  readonly path?: string;
}

export type LayerExecute<TParams, TDetails> = (toolCallId: string, params: TParams, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<TDetails> | undefined, ctx: LayerContext) => Promise<AgentToolResult<TDetails>>;

/**
 * Wrap a tool body so every failure becomes a model-facing error result with the tool's details shape.
 * Pi never sees a thrown error from the layer, so a failed call cannot abort the batch.
 */
export function guarded<TParams, TDetails>(
  detailsForFailure: (failure: ToolFailure) => TDetails,
  run: (args: ExecuteArgs<TParams, TDetails>) => Promise<ToolOutcome<TDetails>>,
  pathOf?: (params: TParams) => string | undefined,
): LayerExecute<TParams, TDetails> {
  return async (toolCallId, params, signal, onUpdate, ctx) => {
    const path = pathOf?.(params);
    try {
      if (signal?.aborted === true) {
        return failureOutcome({ kind: 'rejected', message: 'Operation aborted' }, detailsForFailure);
      }
      const outcome = await run({
        toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
        ...(path === undefined ? {} : { path }),
      });
      return {
        content: outcome.content.map((block) => ({ ...block })),
        details: outcome.details,
        ...(outcome.structuredContent === undefined ? {} : { structuredContent: outcome.structuredContent }),
        ...(outcome.isError === undefined ? {} : { isError: outcome.isError }),
      };
    } catch (error) {
      return failureOutcome(toFailure(error, path), detailsForFailure);
    }
  };
}

/** Emit a progress update when the caller subscribed to one. */
export function emitUpdate<TDetails>(onUpdate: AgentToolUpdateCallback<TDetails> | undefined, text: string, details: TDetails): void {
  onUpdate?.({ content: [{ type: 'text', text }], details });
}
