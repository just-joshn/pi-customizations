/**
 * The startup banner. The reference prints a title, its build, and one rotating
 * tip, each indented two columns; the text is pi's own, because the banner sits
 * above pi's transcript and must not claim to be another program.
 *
 * `VERSION` is pi's public export, so the row survives an upgrade without
 * reading a file or parsing a package manifest.
 */

import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { VERSION } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { fitWidth } from '../format/width.ts';

/** The reference indents its banner by two columns. */
const INDENT = '  ';

/**
 * One tip per launch, the way the reference rotates its own. Each names an
 * affordance that exists in pi at the shipped keybinding.
 */
export const TIPS = [
  'Use /model to switch the model and its thinking level.',
  'Press shift+tab to change the thinking level.',
  'Press / for commands, and @ to mention a file.',
  'Use /compact to summarize the conversation and free context.',
  'Press ctrl+o to expand or collapse tool output.',
];

export function createHeader(ctx: ExtensionContext): (tui: TUI, theme: Theme) => Component {
  void ctx;
  const version = `v${VERSION}`;
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)] ?? '';

  return (_tui, theme) => ({
    render(width: number): string[] {
      return [fitWidth(`${INDENT}${theme.fg('text', 'Pi Coding Agent')}`, width), fitWidth(`${INDENT}${theme.fg('muted', version)}`, width), fitWidth(`${INDENT}${theme.fg('muted', `Tip: ${tip}`)}`, width)];
    },
    invalidate(): void {},
  });
}
