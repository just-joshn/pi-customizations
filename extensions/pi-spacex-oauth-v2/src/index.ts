import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { CURSOR_PROVIDER_ID, cursorProvider } from './cursor/provider.ts';
import { GROK_PROVIDER_ID, grokProvider } from './grok.ts';

export default function piSpacexOauth(pi: ExtensionAPI) {
  pi.registerProvider(GROK_PROVIDER_ID, grokProvider);
  pi.registerProvider(CURSOR_PROVIDER_ID, cursorProvider);
}
