import type { AgentToolResult, Theme, ToolRenderers } from '@earendil-works/pi-coding-agent';
import { type Component, Text } from '@earendil-works/pi-tui';
import { vi } from 'vitest';
import { cell } from '../src/cell.ts';

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
const DEFAULT_CWD = '/project';
interface RowInputs {
  readonly args: Record<string, unknown>;
  readonly started: boolean;
  readonly partial: boolean;
  readonly expanded: boolean;
  readonly result: RowEvent['result'];
}
function rowContext(inputs: RowInputs, state: object, opts: { cwd?: string; outputPad?: number } | undefined, lastComponent: Component | undefined): Context {
  return {
    args: inputs.args,
    state,
    toolCallId: 'test',
    invalidate: () => {
      throw new Error('recursive invalidation');
    },
    lastComponent,
    cwd: opts?.cwd ?? DEFAULT_CWD,
    executionStarted: inputs.started,
    argsComplete: true,
    isPartial: inputs.partial,
    expanded: inputs.expanded,
    showImages: false,
    isError: inputs.result?.isError ?? false,
    durationMs: inputs.partial ? undefined : 10,
    outputPad: opts?.outputPad ?? 1,
    keyText: () => 'ctrl+o',
    keyHint: () => 'ctrl+o to expand',
  };
}
export function driveRow(renderers: ToolRenderers, theme: Theme, opts?: { cwd?: string; outputPad?: number }) {
  const state = {};
  const call = cell<Component | undefined>(undefined);
  const resultComponent = cell<Component | undefined>(undefined);
  const inputs = cell<RowInputs>({ args: {}, started: false, partial: true, expanded: false, result: undefined });
  return {
    state,
    components: {
      get call() {
        return call.read();
      },
      get result() {
        return resultComponent.read();
      },
    },
    apply(event: RowEvent): void {
      if (event.invalidate) {
        call.read()?.invalidate();
        resultComponent.read()?.invalidate();
      }
      const prev = inputs.read();
      const next: RowInputs = {
        args: event.args ?? prev.args,
        started: event.executionStarted ?? prev.started,
        partial: event.isPartial ?? prev.partial,
        expanded: event.expanded ?? prev.expanded,
        result: event.result ?? prev.result,
      };
      inputs.write(next);
      call.write(renderers.renderCall?.(next.args, theme, rowContext(next, state, opts, call.read())));
      if (next.result)
        resultComponent.write(renderers.renderResult?.({ content: next.result.content, details: next.result.details }, { expanded: next.expanded, isPartial: next.partial }, theme, rowContext(next, state, opts, resultComponent.read())));
    },
    lines(width: number): string[] {
      return [...(call.read()?.render(width) ?? []), ...(resultComponent.read()?.render(width) ?? [])];
    },
  };
}
export function recordingNative() {
  const contexts = cell<readonly Context[]>([]);
  const child = new Text('NATIVE 漢字 🙂', 0, 0);
  return {
    get resultContexts() {
      return contexts.read();
    },
    renderCall: vi.fn(() => {
      throw new Error('native renderCall must not run');
    }),
    renderResult: vi.fn((_result, _options, _theme, context: Context) => {
      contexts.write([...contexts.read(), context]);
      return child;
    }),
  } satisfies ToolRenderers & { readonly resultContexts: readonly Context[] };
}
export function output(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}
