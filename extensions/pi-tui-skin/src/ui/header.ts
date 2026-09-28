/** The directory is computed once at factory time, so `render()` never touches the filesystem or Git. */

import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { shortenHomePath } from '../format/path.ts';
import { fitWidth } from '../format/width.ts';

export function createHeader(ctx: ExtensionContext): (tui: TUI, theme: Theme) => Component {
  const home = typeof process.env.HOME === 'string' ? process.env.HOME : '';
  const directory = shortenHomePath(ctx.cwd, home);

  return (_tui, theme) => ({
    render(width: number): string[] {
      return [fitWidth(`${theme.fg('dim', '> ')}${theme.fg('text', 'agent')}`, width), fitWidth(theme.bold(theme.fg('text', 'Pi Coding Agent')), width), fitWidth(theme.fg('muted', directory), width)];
    },
    invalidate(): void {},
  });
}
