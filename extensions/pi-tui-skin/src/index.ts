import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerLifecycle } from './lifecycle/register-lifecycle.ts';
import { createPresentationStore } from './state/presentation-store.ts';
import { loadToolSettings } from './tools/builtins.ts';
import { registerToolRenderers } from './tools/register-tool-renderers.ts';
import { createUiController } from './ui/install-ui.ts';

function reportSettingsFallback(ctx: ExtensionContext): void {
  const settings = loadToolSettings(ctx.cwd);
  if (settings.kind === 'fallback' && ctx.hasUI) {
    ctx.ui.notify(`tui-skin: using default tool settings because settings could not be read (${settings.reason})`, 'warning');
  }
}

export default function tuiSkin(pi: ExtensionAPI): void {
  const store = createPresentationStore();
  const ui = createUiController(store);

  registerToolRenderers(pi);

  registerLifecycle(pi, {
    store,
    onSessionStart(ctx) {
      store.reset();
      ui.install(ctx);
      reportSettingsFallback(ctx);
    },
    onSessionShutdown(ctx) {
      try {
        ui.uninstall(ctx);
      } finally {
        store.reset();
      }
    },
  });
}
