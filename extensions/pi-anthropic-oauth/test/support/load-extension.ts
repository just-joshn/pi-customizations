import type { Provider } from '@earendil-works/pi-ai';
import type { ProviderConfig } from '@earendil-works/pi-coding-agent';
import type { ExtensionHost } from '../../src/index.ts';

// Runs the factory against a fake host that records the one native provider
// registration. Pi's public discovery path is covered in registration.test.ts.
export function captureProvider(factory: (pi: ExtensionHost) => void): Provider {
  const registered: Provider[] = [];
  const api: ExtensionHost = {
    registerProvider: (first: Provider | string, config?: ProviderConfig): void => {
      if (typeof first === 'string') throw new Error(`legacy registerProvider(${JSON.stringify(first)}, config) is not supported, received ${config === undefined ? 'no config' : 'a config'}`);
      registered.push(first);
    },
    on: () => () => undefined,
    appendEntry: () => undefined,
    getAllTools: () => [],
    getActiveTools: () => [],
    getSettings: () => ({}),
  };
  factory(api);
  const [only] = registered;
  if (registered.length !== 1 || !only) throw new Error(`expected one native provider registration, received ${registered.length}`);
  return only;
}
