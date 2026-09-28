/**
 * `uninstall` is idempotent, safe when `install` never ran, and guards each
 * cleanup setter so one failure cannot skip the rest or escape Pi's shutdown.
 */

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import type { PresentationStore } from '../state/presentation-store.ts';
import { ACTIVITY_WIDGET_KEY, installActivityWidget } from './activity-widget.ts';
import { createEditorFactory } from './editor.ts';
import { createFooter } from './footer.ts';
import { createHeader } from './header.ts';
import { installWorkingIndicator } from './working-indicator.ts';

export type UiController = {
  install(ctx: ExtensionContext): void;
  uninstall(ctx: ExtensionContext): void;
};

function safely(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.error('[tui-skin] presentation cleanup step failed', error);
  }
}

export function createUiController(store: PresentationStore): UiController {
  let activeTui: TUI | undefined;
  let unsubscribeStore: (() => void) | undefined;
  let installed = false;

  const capture = (tui: TUI): void => {
    activeTui ??= tui;
  };

  return {
    install(ctx) {
      if (ctx.mode !== 'tui' || installed) return;
      installed = true;

      ctx.ui.setTitle('agent');
      ctx.ui.setTheme('tui-skin');

      const header = createHeader(ctx);
      ctx.ui.setHeader((tui, theme) => {
        capture(tui);
        return header(tui, theme);
      });

      const footer = createFooter(ctx, store);
      ctx.ui.setFooter((tui, theme, footerData) => {
        capture(tui);
        return footer(tui, theme, footerData);
      });

      const editor = createEditorFactory(ctx, store);
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        capture(tui);
        return editor(tui, theme, keybindings);
      });

      installWorkingIndicator(ctx);
      installActivityWidget(ctx, store, capture);
      ctx.ui.setHiddenThinkingLabel('Thinking');

      unsubscribeStore = store.subscribe(() => {
        activeTui?.requestRender();
      });
    },

    uninstall(ctx) {
      if (!installed) return;
      installed = false;

      unsubscribeStore?.();
      unsubscribeStore = undefined;

      safely(() => ctx.ui.setWidget(ACTIVITY_WIDGET_KEY, undefined));
      safely(() => ctx.ui.setEditorComponent(undefined));
      safely(() => ctx.ui.setFooter(undefined));
      safely(() => ctx.ui.setHeader(undefined));
      safely(() => ctx.ui.setWorkingMessage());
      safely(() => ctx.ui.setWorkingIndicator());
      safely(() => ctx.ui.setWorkingVisible(true));
      safely(() => ctx.ui.setHiddenThinkingLabel());
    },
  };
}
