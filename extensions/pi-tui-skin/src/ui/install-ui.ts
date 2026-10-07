/**
 * `uninstall` is idempotent, safe when `install` never ran, and runs every
 * cleanup setter even when one fails, then throws the failures as one error.
 */

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import type { PresentationStore } from '../state/presentation-store.ts';
import { ACTIVITY_WIDGET_KEY, installActivityWidget } from './activity-widget.ts';
import { createEditorFactory } from './editor.ts';
import { createFooter } from './footer.ts';
import { createHeader } from './header.ts';
import { installWorkingIndicator, refreshWorkingIndicator } from './working-indicator.ts';

export type UiController = {
  install(ctx: ExtensionContext): void;
  uninstall(ctx: ExtensionContext): void;
};

type CleanupStep = readonly [name: string, run: (ui: ExtensionContext['ui']) => void];

const CLEANUP_STEPS: readonly CleanupStep[] = [
  ['setWidget', (ui) => ui.setWidget(ACTIVITY_WIDGET_KEY, undefined)],
  ['setEditorComponent', (ui) => ui.setEditorComponent(undefined)],
  ['setFooter', (ui) => ui.setFooter(undefined)],
  ['setHeader', (ui) => ui.setHeader(undefined)],
  ['setWorkingMessage', (ui) => ui.setWorkingMessage()],
  ['setWorkingIndicator', (ui) => ui.setWorkingIndicator()],
  ['setWorkingVisible', (ui) => ui.setWorkingVisible(true)],
  ['setHiddenThinkingLabel', (ui) => ui.setHiddenThinkingLabel()],
];

type CleanupFailure = { readonly name: string; readonly error: unknown };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Restore every surface `install` took over. Every step runs even when an
 * earlier one fails. The failures then leave as one error, which Pi reports as
 * the handler error without stderr output that would corrupt the TUI.
 */
function uninstallControls(ctx: ExtensionContext): void {
  const failures = CLEANUP_STEPS.flatMap(([name, run]): CleanupFailure[] => {
    try {
      run(ctx.ui);
      return [];
    } catch (error) {
      return [{ name, error }];
    }
  });
  if (failures.length === 0) return;
  throw new AggregateError(
    failures.map((failure) => failure.error),
    `tui-skin presentation cleanup failed: ${failures.map((failure) => `${failure.name}: ${describeError(failure.error)}`).join('; ')}`,
  );
}

export function createUiController(store: PresentationStore): UiController {
  let activeTui: TUI | undefined;
  let unsubscribeStore: (() => void) | undefined;
  let indicatorKey = '';
  let installed = false;

  const capture = (tui: TUI): void => {
    activeTui ??= tui;
  };

  return {
    install(ctx) {
      if (ctx.mode !== 'tui' || installed) return;
      installed = true;

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

      const editor = createEditorFactory(ctx, store, () => {
        // The frames carry baked theme colors and this editor paints the band
        // they sit in, so re-derive them from the live theme before every frame.
        if (!installed) return;
        indicatorKey = refreshWorkingIndicator(ctx, indicatorKey);
      });
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        capture(tui);
        return editor(tui, theme, keybindings);
      });

      indicatorKey = installWorkingIndicator(ctx);
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

      uninstallControls(ctx);
    },
  };
}
