import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerLifecycle } from './lifecycle/register-lifecycle.ts';
import { createPresentationStore } from './state/presentation-store.ts';
import { registerToolRenderers } from './tools/register-tool-renderers.ts';
import { createUiController } from './ui/install-ui.ts';

export default function tuiSkin(pi: ExtensionAPI): void {
  const store = createPresentationStore();
  const ui = createUiController(store);

  registerToolRenderers(pi);

  registerLifecycle(pi, {
    store,
    onSessionStart(ctx) {
      store.reset();
      ui.install(ctx);
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
