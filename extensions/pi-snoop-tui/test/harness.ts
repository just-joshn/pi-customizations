import type { AgentToolResult, Theme, ToolRenderers } from '@earendil-works/pi-coding-agent';
import { type Component, Text } from '@earendil-works/pi-tui';
import { vi } from 'vitest';

type Context = Parameters<NonNullable<ToolRenderers['renderCall']>>[2];
export function stubTheme(): Theme {
  return { fg: vi.fn((_color: string, text: string) => `\x1b[37m${text}\x1b[39m`), bg: vi.fn((_color: string, text: string) => text) } as unknown as Theme;
}
export function plain(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/g, '');
}
export interface RowEvent {
  readonly args?: Record<string, unknown>;
  readonly executionStarted?: boolean;
  readonly result?: { readonly content: AgentToolResult<unknown>['content']; readonly details?: unknown; readonly isError?: boolean };
  readonly isPartial?: boolean;
  readonly expanded?: boolean;
  readonly invalidate?: boolean;
}
export function driveRow(renderers: ToolRenderers, theme: Theme, opts?: { cwd?: string; outputPad?: number }) {
  const state = {};
  const components: { call: Component | undefined; result: Component | undefined } = { call: undefined, result: undefined };
  let args: Record<string, unknown> = {};
  let result: RowEvent['result'];
  let started = false;
  let partial = true;
  let expanded = false;
  return {
    state,
    components,
    apply(event: RowEvent): void {
      if (event.invalidate) {
        components.call?.invalidate();
        components.result?.invalidate();
      }
      args = event.args ?? args;
      started = event.executionStarted ?? started;
      partial = event.isPartial ?? partial;
      expanded = event.expanded ?? expanded;
      result = event.result ?? result;
      const context = (lastComponent: Component | undefined): Context => ({
        args,
        state,
        toolCallId: 'test',
        invalidate: () => {
          throw new Error('recursive invalidation');
        },
        lastComponent,
        cwd: opts?.cwd ?? '/project',
        executionStarted: started,
        argsComplete: true,
        isPartial: partial,
        expanded,
        showImages: false,
        isError: result?.isError ?? false,
        durationMs: partial ? undefined : 10,
        outputPad: opts?.outputPad ?? 1,
        keyText: () => 'ctrl+o',
        keyHint: () => 'ctrl+o to expand',
      });
      components.call = renderers.renderCall?.(args, theme, context(components.call));
      if (result) components.result = renderers.renderResult?.({ content: result.content, details: result.details }, { expanded, isPartial: partial }, theme, context(components.result));
    },
    lines(width: number): string[] {
      return [...(components.call?.render(width) ?? []), ...(components.result?.render(width) ?? [])];
    },
  };
}
export function recordingNative() {
  const resultContexts: Context[] = [];
  const child = new Text('NATIVE 漢字 🙂', 0, 0);
  return {
    resultContexts,
    renderCall: vi.fn(() => {
      throw new Error('native renderCall must not run');
    }),
    renderResult: vi.fn((_result, _options, _theme, context: Context) => {
      resultContexts.push(context);
      return child;
    }),
  } satisfies ToolRenderers & { resultContexts: Context[] };
}
export function output(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}
