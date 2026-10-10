/**
 * `uninstall` is idempotent, safe when `install` never ran, and runs every
 * cleanup setter even when one fails, then throws the failures as one error.
 */

import { basename } from 'node:path';

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

type PriorChrome = {
  readonly themeName: string | undefined;
  readonly title: string;
};

/** Official Pi APP_TITLE when not white-labeled. Not exported from the public package surface in 1.1.0. */
const OFFICIAL_APP_TITLE = 'π';

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

function readPriorTitle(ctx: ExtensionContext): string {
  const ui = ctx.ui as ExtensionContext['ui'] & { getTitle?: () => string };
  if (typeof ui.getTitle === 'function') {
    return ui.getTitle();
  }
  // Pi ExtensionUI has no getTitle. Mirror interactive-mode updateTerminalTitle().
  const cwdBasename = basename(ctx.cwd);
  const sessionName = ctx.sessionManager.getSessionName();
  return sessionName === undefined || sessionName.length === 0 ? `${OFFICIAL_APP_TITLE} - ${cwdBasename}` : `${OFFICIAL_APP_TITLE} - ${sessionName} - ${cwdBasename}`;
}

function capturePriorChrome(ctx: ExtensionContext): PriorChrome {
  return {
    themeName: ctx.ui.theme.name,
    title: readPriorTitle(ctx),
  };
}

function restoreSteps(prior: PriorChrome): readonly CleanupStep[] {
  const steps: CleanupStep[] = [];
  if (prior.themeName !== undefined) {
    const themeName = prior.themeName;
    steps.push([
      'setTheme',
      (ui) => {
        ui.setTheme(themeName);
      },
    ]);
  }
  steps.push(['setTitle', (ui) => ui.setTitle(prior.title)]);
  return steps;
}

/**
 * Restore every surface `install` took over. Every step runs even when an
 * earlier one fails. The failures then leave as one error, which Pi reports as
 * the handler error without stderr output that would corrupt the TUI.
 */
function uninstallControls(ctx: ExtensionContext, prior: PriorChrome | undefined): void {
  const steps: readonly CleanupStep[] = prior === undefined ? CLEANUP_STEPS : [...CLEANUP_STEPS, ...restoreSteps(prior)];
  const failures = steps.flatMap(([name, run]): CleanupFailure[] => {
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

function mountChrome(ctx: ExtensionContext, store: PresentationStore, capture: (tui: TUI) => void, onEditorTheme: () => void): string {
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

  const editor = createEditorFactory(ctx, store, onEditorTheme);
  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    capture(tui);
    return editor(tui, theme, keybindings);
  });

  const indicatorKey = installWorkingIndicator(ctx);
  installActivityWidget(ctx, store, capture);
  ctx.ui.setHiddenThinkingLabel('Thinking');
  return indicatorKey;
}

export function createUiController(store: PresentationStore): UiController {
  let activeTui: TUI | undefined;
  let unsubscribeStore: (() => void) | undefined;
  let indicatorKey = '';
  let installed = false;
  let priorChrome: PriorChrome | undefined;

  const capture = (tui: TUI): void => {
    activeTui ??= tui;
  };

  return {
    install(ctx) {
      if (ctx.mode !== 'tui' || installed) return;
      installed = true;
      priorChrome = capturePriorChrome(ctx);
      indicatorKey = mountChrome(ctx, store, capture, () => {
        // The frames carry baked theme colors and this editor paints the band
        // they sit in, so re-derive them from the live theme before every frame.
        if (!installed) return;
        indicatorKey = refreshWorkingIndicator(ctx, indicatorKey);
      });
      unsubscribeStore = store.subscribe(() => {
        activeTui?.requestRender();
      });
    },

    uninstall(ctx) {
      if (!installed) return;
      installed = false;

      unsubscribeStore?.();
      unsubscribeStore = undefined;

      const prior = priorChrome;
      priorChrome = undefined;
      uninstallControls(ctx, prior);
    },
  };
}
