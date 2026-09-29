/**
 * Working indicator: the animated frame set and the truthful `Working` label.
 * Frame strings carry their own theme colors, and Pi renders custom frames
 * verbatim, so they are re-derived from the live theme whenever Pi invalidates
 * the mounted components (its theme-change signal).
 */

import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';

const WORKING_GLYPHS = ['·', '•', '●', '•'] as const;
const WORKING_ROLES = ['dim', 'muted', 'success', 'muted'] as const;
const WORKING_INTERVAL_MS = 120;

export type WorkingIndicatorOptions = { frames: string[]; intervalMs: number };

/** Pure frame builder. The colors come from whichever theme the proxy currently reads. */
export function workingIndicatorOptions(theme: Theme): WorkingIndicatorOptions {
  return {
    frames: WORKING_GLYPHS.map((glyph, index) => theme.fg(WORKING_ROLES[index] ?? 'muted', glyph)),
    intervalMs: WORKING_INTERVAL_MS,
  };
}

/** The rendered frames, which change exactly when the theme's colors do. */
function frameKey(options: WorkingIndicatorOptions): string {
  return options.frames.join('\u0000');
}

export function installWorkingIndicator(ctx: ExtensionContext): string {
  const options = workingIndicatorOptions(ctx.ui.theme);
  ctx.ui.setWorkingIndicator(options);
  ctx.ui.setWorkingMessage('Working');
  return frameKey(options);
}

/**
 * Re-derives the frames and reinstalls them only when the colors changed, so an
 * unrelated invalidation (a resize, a grammar load) does not restart the
 * animation. Returns the key to pass back on the next call.
 */
export function refreshWorkingIndicator(ctx: ExtensionContext, previousKey: string): string {
  const options = workingIndicatorOptions(ctx.ui.theme);
  const key = frameKey(options);
  if (key === previousKey) return previousKey;
  ctx.ui.setWorkingIndicator(options);
  return key;
}
