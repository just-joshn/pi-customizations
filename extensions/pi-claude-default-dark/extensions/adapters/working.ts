import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { CLAUDE } from './palette.js';
import { THEME } from './restyle.js';

export interface WorkingContext {
  mode: ExtensionContext['mode'];
  ui: Pick<ExtensionContext['ui'], 'setWorkingIndicator' | 'setWorkingMessage'> & { theme: Pick<Theme, 'name' | 'style'> };
}

export function workingIndicator(): (event: 'start' | 'turn', ctx: WorkingContext) => void {
  let applied = false;
  return (event, ctx) => {
    if (ctx.mode !== 'tui') return;
    const active = ctx.ui.theme.name === THEME;
    if (event === 'turn' && active === applied) return;
    if (active) {
      const paint = (text: string) => ctx.ui.theme.style(text, { fg: CLAUDE.working });
      ctx.ui.setWorkingIndicator({ frames: ['✻', '✽', '✢', '✶', '·'].map(paint) });
      ctx.ui.setWorkingMessage(paint('Working'));
      applied = true;
    } else if (applied) {
      ctx.ui.setWorkingIndicator();
      ctx.ui.setWorkingMessage();
      applied = false;
    }
  };
}
