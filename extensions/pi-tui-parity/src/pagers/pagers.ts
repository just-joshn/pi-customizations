/**
 * Reference /context, /usage and /copy pagers (research: source-screens.md §2
 * Pagers (context, usage, copy-message), .audit parts/07-screens.txt rows
 * pager.context-*, pager.usage-header, pager.copy-message). Pi adaptation:
 * usage totals come from the local session branch, not the billing API.
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { getNativeClipboard, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { formatTokens } from '../format.ts';
import { getTokens, paletteFg } from '../palette.ts';
import { type ContextScreenData, renderContextScreen } from './context.ts';

const COPY_VISIBLE_ROWS = 5;
const COPY_PREVIEW_WIDTH = 60;

export class ContextPager implements Component {
  private closed = false;

  constructor(
    readonly _tui: { requestRender: () => void },
    private readonly theme: Theme,
    private readonly data: ContextScreenData,
    private readonly done: (result: undefined) => void,
  ) {}

  handleInput(_data: string): void {
    if (this.closed) return;
    this.closed = true;
    this.done(undefined);
  }

  invalidate(): void {}

  render(width: number): string[] {
    return [...renderContextScreen({ ...this.data, width, theme: this.theme }), '', this.theme.fg('dim', 'Esc to close')];
  }
}

export interface UsageRow {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly cost: number;
}

export function usageRows(entries: readonly unknown[]): UsageRow[] {
  const byModel = new Map<string, UsageRow>();
  for (const entry of entries) {
    const e = entry as { type?: string; message?: { role?: string; model?: string; usage?: { input?: number; output?: number; cost?: { total?: number } } } };
    if (e?.type !== 'message' || e.message?.role !== 'assistant') continue;
    const key = e.message.model ?? 'unknown';
    const row = byModel.get(key) ?? { model: key, input: 0, output: 0, cost: 0 };
    byModel.set(key, {
      model: key,
      input: row.input + (e.message.usage?.input ?? 0),
      output: row.output + (e.message.usage?.output ?? 0),
      cost: row.cost + (e.message.usage?.cost?.total ?? 0),
    });
  }
  return [...byModel.values()];
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(3)}`;
}

export class UsagePager implements Component {
  private closed = false;

  constructor(
    readonly _tui: { requestRender: () => void },
    private readonly theme: Theme,
    private readonly rows: readonly UsageRow[],
    private readonly done: (result: undefined) => void,
  ) {}

  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, 'escape') || data === 'q') {
      this.closed = true;
      this.done(undefined);
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const tokens = getTokens(this.theme.name);
    const accent = (s: string) => paletteFg(tokens.pagerAccent, this.theme.getColorMode(), this.theme.bold(s));
    const dim = (s: string) => this.theme.fg('dim', s);
    const lines = [accent('Usage'), dim('Session usage by model.')];
    if (this.rows.length === 0) {
      lines.push('', dim('No usage recorded yet.'));
    } else {
      const modelWidth = Math.max(...this.rows.map((r) => r.model.length));
      const inWidth = Math.max(...this.rows.map((r) => formatTokens(r.input).length));
      const outWidth = Math.max(...this.rows.map((r) => formatTokens(r.output).length));
      for (const r of this.rows) {
        lines.push(`${r.model.padEnd(modelWidth)}  ${formatTokens(r.input).padStart(inWidth)}  ${formatTokens(r.output).padStart(outWidth)}  ${formatCost(r.cost)}`);
      }
    }
    lines.push('', dim('Esc to close'));
    return lines.map((l) => truncateToWidth(l, width));
  }
}

export interface CopyRow {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export function copyRows(entries: readonly unknown[], limit = 20): CopyRow[] {
  const rows: CopyRow[] = [];
  for (const entry of entries) {
    const e = entry as { type?: string; message?: { role?: string; content?: unknown } };
    const role = e?.type === 'message' ? e.message?.role : undefined;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = messageText(e.message?.content);
    if (text.trim().length === 0) continue;
    rows.push({ role, text });
  }
  return rows.slice(-limit);
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => ((part as { type?: string }).type === 'text' ? (part as { text: string }).text : '')).join('\n');
}

export class CopyPager implements Component {
  private selected = 0;
  private offset = 0;
  private closed = false;

  constructor(
    private readonly tui: { requestRender: () => void },
    private readonly theme: Theme,
    private readonly rows: readonly CopyRow[],
    private readonly done: (result: string | undefined) => void,
  ) {}

  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, 'up') || data === 'k') {
      this.move(-1);
      return;
    }
    if (matchesKey(data, 'down') || data === 'j') {
      this.move(1);
      return;
    }
    if (matchesKey(data, 'escape') || data === 'q') {
      this.close(undefined);
      return;
    }
    if (matchesKey(data, 'return')) this.copySelected();
  }

  private move(delta: number): void {
    this.selected = (this.selected + this.rows.length + delta) % this.rows.length;
    if (this.selected < this.offset) this.offset = this.selected;
    if (this.selected >= this.offset + COPY_VISIBLE_ROWS) this.offset = this.selected - COPY_VISIBLE_ROWS + 1;
    this.tui.requestRender();
  }

  private copySelected(): void {
    const row = this.rows[this.selected];
    if (!row) return;
    void getNativeClipboard()
      ?.setText?.(row.text)
      ?.catch(() => {});
    this.close(row.text);
  }

  private close(result: string | undefined): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const tokens = getTokens(this.theme.name);
    const mode = this.theme.getColorMode();
    const accent = (s: string) => paletteFg(tokens.pagerAccent, mode, s);
    const dim = (s: string) => this.theme.fg('dim', s);
    const lines = [accent(this.theme.bold('Copy a message')) + dim(` (${this.rows.length} messages)`)];
    const visible = this.rows.slice(this.offset, this.offset + COPY_VISIBLE_ROWS);
    visible.forEach((row, i) => {
      const prefix = row.role === 'user' ? 'You  ' : 'Agent ';
      const preview = row.text.split('\n')[0]?.slice(0, COPY_PREVIEW_WIDTH) ?? '';
      if (this.offset + i === this.selected) {
        lines.push(truncateToWidth(`${accent('→ ')}${this.theme.bold(prefix + preview)}`, width));
      } else {
        lines.push(truncateToWidth(`  ${dim(prefix)}${preview}`, width));
      }
    });
    lines.push('', dim('↑/↓ to navigate • Enter to copy • Esc to close'));
    return lines;
  }
}

function contextData(ctx: ExtensionCommandContext): ContextScreenData {
  const usage = ctx.getContextUsage();
  const contextWindow = ctx.model?.contextWindow ?? usage?.contextWindow ?? 0;
  const tokens = usage?.tokens ?? null;
  const systemEstimate = Math.ceil(ctx.getSystemPrompt().length / 4);
  return {
    modelName: ctx.model?.name,
    contextWindow,
    tokens,
    percent: usage?.percent ?? null,
    categories:
      tokens === null
        ? [{ label: 'Conversation', tokens: 0 }]
        : [
            { label: 'System prompt', tokens: systemEstimate },
            { label: 'Messages', tokens: Math.max(0, tokens - systemEstimate) },
          ],
  };
}

export function installPagers(pi: ExtensionAPI): void {
  pi.registerCommand('context', {
    description: 'Show context usage breakdown',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui' || !ctx.hasUI) return;
      await ctx.ui.custom((tui, theme, _keybindings, done) => new ContextPager(tui, theme, contextData(ctx), done));
    },
  });
  pi.registerCommand('usage', {
    description: 'Show session token and cost usage by model',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui' || !ctx.hasUI) return;
      await ctx.ui.custom((tui, theme, _keybindings, done) => new UsagePager(tui, theme, usageRows(ctx.sessionManager.getBranch()), done));
    },
  });
}
