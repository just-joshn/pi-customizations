/**
 * The footer. The reference draws a mode row only once the mode leaves its
 * startup state, then a model row carrying the context percentage, then a
 * location row. The mode row's label is pi's thinking level, which is the only
 * "how hard should this think" state pi has, and `shift+tab` really does cycle
 * it.
 *
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

type ThinkingDisplay = { level: ThinkingLevel; label: string; role: ThemeColor };

const THINKING_DISPLAY: Record<ThinkingLevel, Omit<ThinkingDisplay, 'level'>> = {
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
  if (level === undefined) return undefined;
  return { level, ...THINKING_DISPLAY[level] };
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
 *
 * The thinking level read at factory time is the session's starting level, which
 * is what the mode row compares against: the reference shows its mode row only
 * when the mode has been changed.
 */

export function createFooter(ctx: ExtensionContext, store: PresentationStore): (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose(): void } {
  const home = typeof process.env.HOME === 'string' ? process.env.HOME : '';
  const directory = shortenHomePath(ctx.cwd, home);
  const startingLevel = readThinking(ctx)?.level;

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
        const rows: string[] = [];

        const thinking = readThinking(ctx);
        if (thinking !== undefined && thinking.level !== startingLevel) {
          rows.push(fitWidth(`${INDENT}${theme.fg(thinking.role, `${thinking.label} (shift+tab to cycle)`)}`, width));
        }

        // The reference prints the percentage only once context is in use, and
        // an unknown model still gets its row so the footer keeps its height.
        const segments: string[] = [];
        const model = readModel(ctx);
        if (model !== undefined) segments.push(theme.fg('text', model));
        const percent = readUsage(ctx)?.percent;
        if (typeof percent === 'number' && percent > 0) segments.push(theme.fg('dim', `${Math.round(percent)}%`));
        rows.push(fitWidth(`${INDENT}${segments.join(theme.fg('dim', ' · '))}`, width));

        const branch = footerData.getGitBranch();
        const hasBranch = typeof branch === 'string' && branch.length > 0;
        rows.push(fitWidth(`${INDENT}${theme.fg('dim', hasBranch ? `${directory}${theme.fg('dim', ' · ')}${branch}` : directory)}`, width));

        return rows;
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
