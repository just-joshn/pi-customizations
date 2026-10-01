import type { Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ProviderConfig } from '@earendil-works/pi-coding-agent';

type RegisteringExtension = (pi: Pick<ExtensionAPI, 'registerProvider'>) => void;

// Runs a factory that only calls registerProvider against a fake of that one method.
// Pi's public discovery path is covered separately in registration.test.ts.
export function captureProvider(factory: RegisteringExtension): Provider {
  const registered: Provider[] = [];
  const registerProvider = (first: Provider | string, config?: ProviderConfig): void => {
    if (typeof first === 'string') throw new Error(`legacy registerProvider(${JSON.stringify(first)}, config) is not supported, received ${config === undefined ? 'no config' : 'a config'}`);
    registered.push(first);
  };
  factory({ registerProvider });
  const [only] = registered;
  if (registered.length !== 1 || !only) throw new Error(`expected one native provider registration, received ${registered.length}`);
  return only;
}
