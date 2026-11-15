import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installMaintainer } from './core/install.ts';
import { editFeature } from './edit/feature.ts';
import { createEditPromptSource } from './edit/prompt-source.ts';
import { gitFeature } from './git/feature.ts';
import { lintFeature } from './lint/feature.ts';
import { mapFeature } from './map/feature.ts';

export default function piMaintainer(pi: ExtensionAPI): void {
  pi.on('session_start', (event, ctx) => {
    if (event.reason === 'startup') ctx.ui.notify('pi-maintainer is deprecated and gets no more updates. It keeps working, but nothing replaces it. Remove it with `pi remove npm:@justjoshn/pi-maintainer`.', 'warning');
  });
  installMaintainer(pi, [editFeature, gitFeature, mapFeature, lintFeature], {
    promptSource: createEditPromptSource(),
  });
}
