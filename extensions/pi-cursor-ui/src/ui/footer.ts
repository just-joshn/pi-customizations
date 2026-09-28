/**
 * Both subscriptions are released by `dispose()`, which the host calls for
 * footer components.
 */

import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ContextUsage, ExtensionContext, ReadonlyFooterDataProvider, Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { fitLeftRight, fitWidth } from '../format/width.ts';
import type { PresentationStore } from '../state/presentation-store.ts';

type ThinkingDisplay = { label: string; role: ThemeColor };

const THINKING_DISPLAY: Record<ThinkingLevel, ThinkingDisplay> = {
  off: { label: 'Off', role: 'thinkingOff' },
  minimal: { label: 'Minimal', role: 'thinkingMinimal' },
  low: { label: 'Low', role: 'thinkingLow' },
  medium: { label: 'Medium', role: 'thinkingMedium' },
  high: { label: 'High', role: 'thinkingHigh' },
  xhigh: { label: 'Extra High', role: 'thinkingXhigh' },
  max: { label: 'Max', role: 'thinkingMax' },
};

// Context reads can throw once Pi deactivates the session runtime; the render
// path must survive that instead of crashing Pi.
function readThinking(ctx: ExtensionContext): ThinkingDisplay | undefined {
  let level: ThinkingLevel | undefined;
  try {
    level = ctx.thinkingLevel;
  } catch {
    return undefined;
  }
  return level === undefined ? undefined : THINKING_DISPLAY[level];
}

function readUsage(ctx: ExtensionContext): ContextUsage | undefined {
  try {
    return ctx.getContextUsage();
  } catch {
    return undefined;
  }
}

function readModel(ctx: ExtensionContext): string | undefined {
  try {
    const model = ctx.model;
    return model?.name ?? model?.id;
  } catch {
    return undefined;
  }
}

export function createFooter(ctx: ExtensionContext, store: PresentationStore): (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose(): void } {
  return (tui, theme, footerData) => {
    const unsubscribeBranch = footerData.onBranchChange(() => {
      tui.requestRender();
    });
    const unsubscribeStore = store.subscribe(() => {
      tui.requestRender();
    });
    let disposed = false;

    return {
      render(width: number): string[] {
        const thinking = readThinking(ctx);
        const thinkingLine = fitLeftRight(thinking === undefined ? '' : `${theme.fg(thinking.role, '●')} ${theme.fg('text', thinking.label)}`, theme.fg('dim', 'shift+tab to cycle'), width);

        const usage = readUsage(ctx);
        const model = readModel(ctx);
        const edited = store.getSnapshot().editedFiles.size;
        const segments: string[] = [];
        if (model !== undefined) segments.push(theme.fg('text', model));
        if (typeof usage?.percent === 'number') segments.push(theme.fg('dim', `${Math.round(usage.percent)}%`));
        if (edited > 0) segments.push(theme.fg('dim', `${edited} file${edited === 1 ? '' : 's'} edited`));
        const branch = footerData.getGitBranch();
        const modelLine = fitLeftRight(segments.join(theme.fg('dim', ' · ')), typeof branch === 'string' && branch.length > 0 ? theme.fg('muted', branch) : '', width);

        const hints = fitWidth(
          `${theme.fg('text', '/')}${theme.fg('dim', ' commands')}${theme.fg('dim', ' · ')}${theme.fg('text', '@')}${theme.fg('dim', ' files')}${theme.fg('dim', ' · ')}${theme.fg('text', '!')}${theme.fg('dim', ' shell')}`,
          width,
        );

        return [thinkingLine, modelLine, hints];
      },
      invalidate(): void {},
      dispose(): void {
        if (disposed) return;
        disposed = true;
        unsubscribeBranch();
        unsubscribeStore();
      },
    };
  };
}
