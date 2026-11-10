import type { Provider } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';

export function builtinXai(): Provider {
  const xai = builtinProviders().find((provider) => provider.id === 'xai');
  if (!xai) throw new Error("Pi's built-in xai provider is missing");
  return xai;
}
