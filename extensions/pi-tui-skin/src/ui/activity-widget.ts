/** The host calls `dispose()` for widget components, which unsubscribes from the store. */

import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { TruncatedText } from '@earendil-works/pi-tui';
import { shortenHomePath } from '../format/path.ts';
import { fitWidth } from '../format/width.ts';
import type { RunningToolActivity } from '../state/presentation-state.ts';
import { toolTarget } from '../state/presentation-state.ts';
import type { PresentationStore } from '../state/presentation-store.ts';

export const ACTIVITY_WIDGET_KEY = 'tui-skin.activity';

type ActivityWords = { verb: string; noun: string; plural: string };

const ACTIVITY_WORDS: Record<string, ActivityWords> = {
  read: { verb: 'Reading', noun: 'file', plural: 'files' },
  edit: { verb: 'Editing', noun: 'file', plural: 'files' },
  write: { verb: 'Writing', noun: 'file', plural: 'files' },
  grep: { verb: 'Searching', noun: 'match', plural: 'matches' },
  find: { verb: 'Finding', noun: 'file', plural: 'files' },
  ls: { verb: 'Listing', noun: 'directory', plural: 'directories' },
  bash: { verb: 'Running', noun: 'command', plural: 'commands' },
  powershell: { verb: 'Running', noun: 'command', plural: 'commands' },
};

const FALLBACK_WORDS: ActivityWords = { verb: 'Running', noun: 'step', plural: 'steps' };
const QUOTED_TARGET_TOOLS = new Set(['grep', 'find']);
const TARGET_MAX_WIDTH = 60;

function wordsFor(toolName: string): ActivityWords {
  return ACTIVITY_WORDS[toolName] ?? FALLBACK_WORDS;
}

export function describeActivity(activities: readonly RunningToolActivity[], home: string): string {
  if (activities.length === 0) return '';

  if (activities.length === 1) {
    const activity = activities[0];
    if (activity === undefined) return '';
    const words = wordsFor(activity.toolName);
    const target = toolTarget(activity.args);
    if (target === undefined) return `${words.verb} ${words.noun}`;
    const display = fitWidth(shortenHomePath(target, home), TARGET_MAX_WIDTH);
    return `${words.verb} ${QUOTED_TARGET_TOOLS.has(activity.toolName) ? `"${display}"` : display}`;
  }

  const counts = new Map<string, number>();
  for (const activity of activities) {
    counts.set(activity.toolName, (counts.get(activity.toolName) ?? 0) + 1);
  }

  const segments: string[] = [];
  for (const [toolName, count] of counts) {
    const words = wordsFor(toolName);
    segments.push(count > 1 ? `${words.verb} ${count} ${words.plural}` : `${words.verb} ${words.noun}`);
  }
  return segments.join(', ');
}

export function installActivityWidget(ctx: ExtensionContext, store: PresentationStore, onTui?: (tui: TUI) => void): void {
  const home = typeof process.env.HOME === 'string' ? process.env.HOME : '';

  ctx.ui.setWidget(
    ACTIVITY_WIDGET_KEY,
    (tui, theme) => {
      onTui?.(tui);
      return createActivityComponent({ tui, theme, store, home });
    },
    { placement: 'aboveEditor' },
  );
}

export function createActivityComponent(input: { tui: TUI; theme: Theme; store: PresentationStore; home: string }): Component & { dispose(): void } {
  const { tui, theme, store, home } = input;
  const unsubscribe = store.subscribe(() => {
    tui.requestRender();
  });
  let disposed = false;

  return {
    render(width: number): string[] {
      const text = describeActivity([...store.getSnapshot().activeTools.values()], home);
      if (text === '') return [];
      return new TruncatedText(`${theme.fg('success', '●')} ${theme.fg('text', text)}`, 0, 0).render(width);
    },
    invalidate(): void {},
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}
