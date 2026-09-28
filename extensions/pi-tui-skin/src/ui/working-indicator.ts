/**
 * Working indicator: the animated frame set and the truthful `Working` label.
 * Frame strings carry their own theme colors, so they are built from the live
 * theme proxy at install time.
 */

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export function installWorkingIndicator(ctx: ExtensionContext): void {
  const { theme } = ctx.ui;

  ctx.ui.setWorkingIndicator({
    frames: [theme.fg('dim', '·'), theme.fg('muted', '•'), theme.fg('success', '●'), theme.fg('muted', '•')],
    intervalMs: 120,
  });

  ctx.ui.setWorkingMessage('Working');
}
