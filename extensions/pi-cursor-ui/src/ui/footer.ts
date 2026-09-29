/**
 * Both subscriptions are released by `dispose()`, which the host calls for
 * footer components.
 */

import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ContextUsage, ExtensionContext, ReadonlyFooterDataProvider, Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { shortenHomePath } from '../format/path.ts';
import { fitWidth } from '../format/width.ts';
import type { PresentationStore } from '../state/presentation-store.ts';

/** The reference indents every footer row by two columns. */
const INDENT = '  ';

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

/**
 * `branch` is read on every render, not cached, because the footer data provider
 * only exists once Pi mounts the footer. The home-relative directory is computed
 * once at factory time, so `render()` never touches the filesystem or Git.
 */

export function createFooter(ctx: ExtensionContext, store: PresentationStore): (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose(): void } {
  const home = typeof process.env.HOME === 'string' ? process.env.HOME : '';
  const directory = shortenHomePath(ctx.cwd, home);
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
        // The reference indents the footer, puts the cycle hint in parentheses
        // on the mode line, and right-aligns nothing. Every row is fitted after
        // the indent, so a one-column pane cannot overflow.
        const thinking = readThinking(ctx);
        const modeLine = fitWidth(thinking === undefined ? INDENT : `${INDENT}${theme.fg(thinking.role, `${thinking.label} (shift+tab to cycle)`)}`, width);

        const usage = readUsage(ctx);
        const model = readModel(ctx);
        const edited = store.getSnapshot().editedFiles.size;
        const segments: string[] = [];
        if (model !== undefined) segments.push(theme.fg('text', model));
        if (typeof usage?.percent === 'number') segments.push(theme.fg('dim', `${Math.round(usage.percent)}%`));
        if (edited > 0) segments.push(theme.fg('dim', `${edited} file${edited === 1 ? '' : 's'} edited`));
        const modelLine = fitWidth(`${INDENT}${segments.join(theme.fg('dim', ' · '))}`, width);

        // The reference puts `<directory> · <branch>` on the last footer row.
        const branch = footerData.getGitBranch();
        const hasBranch = typeof branch === 'string' && branch.length > 0;
        const location = fitWidth(`${INDENT}${theme.fg('dim', hasBranch ? `${directory}${theme.fg('dim', ' · ')}${branch}` : directory)}`, width);

        return [modeLine, modelLine, location];
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
