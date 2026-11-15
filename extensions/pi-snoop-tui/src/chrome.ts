import { basename } from 'node:path';

import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { fitPlain, sanitizeLine } from './text.ts';

export default function chrome(pi: ExtensionAPI): void {
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setHeader((_tui, theme) => new HeaderLine(theme, basename(ctx.cwd) || ctx.cwd));
    setIndicator(ctx);
  });
  pi.on('agent_start', (_event, ctx) => {
    if (ctx.hasUI) setIndicator(ctx);
  });
}
function setIndicator(ctx: ExtensionContext): void {
  ctx.ui.setWorkingIndicator({ frames: [ctx.ui.theme.fg('accent', '●')] });
}
export class HeaderLine implements Component {
  private cache: { width: number; line: string } | undefined;
  private readonly theme: Theme;
  private readonly workspace: string;
  constructor(theme: Theme, workspace: string) {
    this.theme = theme;
    this.workspace = workspace;
  }
  render(width: number): string[] {
    if (this.cache?.width === width) return [this.cache.line];
    const line = width < 5 ? this.theme.fg('accent', fitPlain('pi', width)) : this.theme.fg('accent', 'pi') + this.theme.fg('dim', ' / ') + this.theme.fg('muted', fitPlain(sanitizeLine(this.workspace), width - 5));
    this.cache = { width, line };
    return [line];
  }
  invalidate(): void {
    this.cache = undefined;
  }
}
