import { getLanguageFromPath, highlightCode, type Theme, type ToolRenderers } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { foregroundAnsi } from '@earendil-works/pi-tui';
import { type Highlight, restyleDiff } from './diff.js';
import { CLAUDE } from './palette.js';
import { parse, serialize } from './sgr.js';

export const THEME = 'claude-default-dark';

export class RestyleComponent implements Component {
  private cache: { width: number; stamp: string; input: string[]; output: string[] } | undefined;
  constructor(
    readonly inner: Component,
    private readonly transform: (lines: string[]) => string[],
    private readonly stamp: () => string = () => '',
  ) {}
  render(width: number): string[] {
    const lines = this.inner.render(width);
    const stamp = this.stamp();
    const cache = this.cache;
    if (cache && cache.width === width && cache.stamp === stamp && cache.input.length === lines.length && cache.input.every((line, index) => line === lines[index])) return cache.output;
    let output = lines;
    try {
      output = this.transform(lines);
    } catch {}
    this.cache = { width, stamp, input: [...lines], output };
    return output;
  }
  invalidate(): void {
    this.cache = undefined;
    this.inner.invalidate();
  }
  handleInput(data: string): void {
    this.inner.handleInput?.(data);
  }
  handleMouse(event: Parameters<NonNullable<Component['handleMouse']>>[0]): ReturnType<NonNullable<Component['handleMouse']>> {
    return this.inner.handleMouse?.(event);
  }
  get wantsKeyRelease(): boolean {
    return this.inner.wantsKeyRelease ?? false;
  }
  get capturesViewportInput(): boolean {
    return this.inner.capturesViewportInput ?? false;
  }
}

export function restyleLines(lines: string[], tool: string, slot: 'call' | 'result', theme: Theme, context: { expanded: boolean; isPartial: boolean; isError: boolean }, highlight?: Highlight): string[] {
  if (theme.name !== THEME) return lines;
  let result = tool === 'edit' ? restyleDiff(lines, theme, highlight) : lines;
  const headerIndex = slot === 'call' ? lines.findIndex((line) => parse(line).some((cell) => cell.text.trim())) : -1;
  result = result.map((line, index) => {
    const path = slot === 'call' && index === headerIndex && (tool === 'read' || tool === 'edit');
    const header = slot === 'call' && index === headerIndex && (tool === 'read' || tool === 'bash') && (!context.expanded || (tool === 'bash' && context.isPartial));
    const error = slot === 'result' && tool === 'bash' && context.isError;
    if (!path && !header && !error) return line;
    const role = path ? theme.getFgAnsi('accent') : header ? theme.getFgAnsi('toolTitle') : theme.getFgAnsi('toolOutput');
    if (!line.includes(role) && !(error && line.includes(theme.getFgAnsi('error')))) return line;
    const cells = parse(line);
    let changed = false;
    const titleEnd = tool === 'read' ? (/^\s*read\b/.exec(cells.map((cell) => cell.text).join(''))?.[0].length ?? 0) : cells.length;
    for (const [cellIndex, cell] of cells.entries()) {
      const pathRun = path && cell.fg === theme.getFgAnsi('accent');
      if (pathRun) {
        cell.fg = '\x1b[39m';
        changed = true;
      }
      if (header && cellIndex < titleEnd && !pathRun && cell.fg === theme.getFgAnsi('toolTitle')) {
        cell.fg = foregroundAnsi(CLAUDE.collapsedTitle, theme.getColorMode());
        cell.bold = false;
        changed = true;
      }
      if (error && cell.text.trim() && (cell.fg === theme.getFgAnsi('toolOutput') || cell.fg === theme.getFgAnsi('error'))) {
        cell.fg = foregroundAnsi(CLAUDE.toolFailure, theme.getColorMode());
        changed = true;
      }
    }
    return changed ? serialize(cells) : line;
  });
  return result;
}

function highlighterFor(args: unknown): Highlight | undefined {
  const path = typeof args === 'object' && args !== null && 'path' in args && typeof args.path === 'string' ? args.path : undefined;
  const language = path ? getLanguageFromPath(path) : undefined;
  return language ? (code) => highlightCode(code, language) : undefined;
}

export function adaptRenderers(tool: string, base: ToolRenderers | undefined): ToolRenderers | undefined {
  if (!base || !['read', 'edit', 'bash'].includes(tool)) return base;
  const call = base.renderCall;
  const result = base.renderResult;
  return {
    ...base,
    ...(call
      ? {
          renderCall: ((args, theme, context) => {
            const inner = call(args, theme, { ...context, lastComponent: context.lastComponent instanceof RestyleComponent ? context.lastComponent.inner : context.lastComponent });
            return theme.name === THEME
              ? new RestyleComponent(
                  inner,
                  (lines) => (theme.name === THEME ? restyleLines(lines, tool, 'call', theme, context, highlighterFor(args)) : lines),
                  () => `${theme.name}|${context.expanded}|${context.isPartial}|${context.isError}`,
                )
              : inner;
          }) satisfies NonNullable<ToolRenderers['renderCall']>,
        }
      : {}),
    ...(result
      ? {
          renderResult: ((value, options, theme, context) => {
            const inner = result(value, options, theme, { ...context, lastComponent: context.lastComponent instanceof RestyleComponent ? context.lastComponent.inner : context.lastComponent });
            return theme.name === THEME
              ? new RestyleComponent(
                  inner,
                  (lines) => (theme.name === THEME ? restyleLines(lines, tool, 'result', theme, context, highlighterFor(context.args)) : lines),
                  () => `${theme.name}|${context.expanded}|${context.isPartial}|${context.isError}`,
                )
              : inner;
          }) satisfies NonNullable<ToolRenderers['renderResult']>,
        }
      : {}),
  };
}
