/**
 * the reference CLI PromptFooter parity (research: source-composer.md §3).
 * Row A: mode headline (Plan/Ask/Debug/custom). Row B: model · context% · files
 * edited (left, dim), autorun + vim labels (right). Row C: cwd · git branch.
 * Layout: column with marginLeft 2, marginRight 1.
 *
 * Pi-specific adaptations, documented in docs/parity.md: the MAX-mode label, PR
 * hyperlink, custom statusLine command, and the exit-armed line are omitted.
 */

import type { ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { formatTokens } from '../format.ts';
import { basicFg, type HexColor, paletteFg } from '../palette.ts';
import { autorunLabel, modeHeadline, type TuiSessionState, vimFooterLabel } from '../state.ts';

export function formatContextPercent(percent: number | null, tokens: number | null): string {
  if (percent !== null) {
    const rounded = Math.round(percent * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
  }
  if (tokens !== null) return formatTokens(tokens);
  return '-';
}

export function formatContextWindow(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`;
}

export function countEditedFiles(entries: readonly unknown[]): number {
  const paths = new Set<string>();
  for (const entry of entries) {
    const e = entry as { type?: string; message?: { role?: string; toolCalls?: { name?: string; arguments?: unknown }[] } };
    if (e?.type !== 'message' || e.message?.role !== 'assistant') continue;
    for (const call of e.message.toolCalls ?? []) {
      if (call.name !== 'edit' && call.name !== 'write') continue;
      const args = typeof call.arguments === 'string' ? safeParse(call.arguments) : call.arguments;
      const path = (args as { path?: unknown } | undefined)?.path;
      if (typeof path === 'string') paths.add(path);
    }
  }
  return paths.size;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function renderFooterRows(opts: {
  theme: Theme;
  state: TuiSessionState;
  modelName: string | undefined;
  contextWindow: number | undefined;
  contextPercent: number | null;
  contextTokens: number | null;
  filesEdited: number;
  cwd: string;
  home: string;
  branch: string | undefined;
  width: number;
}): string[] {
  const { theme, state, width } = opts;
  const mode: ThemeColorMode = theme.getColorMode();
  const lines: string[] = [];
  const indent = '  ';
  const headline = modeHeadline(state, width);
  if (headline) {
    lines.push(truncateToWidth(`${indent}${paletteFg(headline.color, mode, theme.bold(headline.text))}`, width));
  }

  const left = buildLeftGroup(opts, theme);
  const right = buildRightGroup(state, mode);
  const inner = Math.max(1, width - indent.length - 1);
  lines.push(truncateToWidth(`${indent}${joinRow(left, right, inner)}`, width));

  lines.push(truncateToWidth(`${indent}${theme.fg('dim', buildLocationRow(opts))}`, width));
  return lines;
}

function buildLeftGroup(opts: { theme: Theme; modelName?: string; contextWindow?: number; contextPercent: number | null; contextTokens: number | null; filesEdited: number }, theme: Theme): string {
  const dim = (s: string) => theme.fg('dim', s);
  const parts: string[] = [];
  if (opts.modelName) {
    let model = opts.modelName;
    if (opts.contextWindow) model += ` · ${formatContextWindow(opts.contextWindow)}`;
    parts.push(model);
  }
  parts.push(formatContextPercent(opts.contextPercent, opts.contextTokens));
  if (opts.filesEdited > 0) parts.push(`${opts.filesEdited} file${opts.filesEdited === 1 ? '' : 's'} edited`);
  return parts.map(dim).join(dim(' · '));
}

type ThemeColorMode = ReturnType<Theme['getColorMode']>;

function buildRightGroup(state: TuiSessionState, mode: ThemeColorMode): string {
  const pieces: string[] = [];
  const autorun = autorunLabel(state);
  if (autorun) pieces.push(basicFg(5, autorun, mode));
  const vim = vimFooterLabel(state);
  if (vim) pieces.push(vim);
  return pieces.join(' · ');
}

function joinRow(left: string, right: string, width: number): string {
  const lw = visibleWidth(left);
  const rw = visibleWidth(right);
  if (lw + rw + 1 >= width) return truncateToWidth(`${left} ${right}`, width);
  return `${left}${' '.repeat(width - lw - rw)}${right}`;
}

function buildLocationRow(opts: { cwd: string; home: string; branch?: string }): string {
  const cwd = opts.home && opts.cwd.startsWith(opts.home) ? `~${opts.cwd.slice(opts.home.length)}` : opts.cwd;
  return opts.branch ? `${cwd} · ${opts.branch}` : cwd;
}

export function installFooter(pi: ExtensionAPI, state: TuiSessionState): void {
  pi.on('session_start', async (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const model = ctx.model;
          const usage = ctx.getContextUsage();
          return renderFooterRows({
            theme,
            state,
            modelName: model?.name,
            contextWindow: model?.contextWindow,
            contextPercent: usage?.percent ?? null,
            contextTokens: usage?.tokens ?? null,
            filesEdited: countEditedFiles(ctx.sessionManager.getBranch()),
            cwd: ctx.cwd,
            home: process.env.HOME ?? '',
            branch: footerData.getGitBranch() ?? undefined,
            width,
          });
        },
      };
    });
  });
}

export type { HexColor };
