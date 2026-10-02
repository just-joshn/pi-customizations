import type { Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext, ExtensionVirtualModel, ProviderConfig } from '@earendil-works/pi-coding-agent';

type Registering = Pick<ExtensionAPI, 'registerProvider' | 'registerVirtualModel'>;

export type Registrations = {
  readonly providers: readonly Provider[];
  readonly virtualModels: readonly ExtensionVirtualModel[];
};

export function register(factory: (pi: Registering) => void): Registrations {
  const providers: Provider[] = [];
  const virtualModels: ExtensionVirtualModel[] = [];
  const registerProvider = (first: Provider | string, config?: ProviderConfig): void => {
    if (typeof first === 'string') throw new Error(`legacy registerProvider(${JSON.stringify(first)}, config) is not supported, received ${config === undefined ? 'no config' : 'a config'}`);
    providers.push(first);
  };
  const registerVirtualModel = (model: ExtensionVirtualModel): void => {
    virtualModels.push(model);
  };
  factory({ registerProvider, registerVirtualModel });
  return { providers, virtualModels };
}

export function onlyProvider(registrations: Registrations): Provider {
  const [only] = registrations.providers;
  if (registrations.providers.length !== 1 || !only) throw new Error(`expected one native provider registration, received ${registrations.providers.length}`);
  return only;
}

type ModelLookup = ExtensionContext['modelRegistry']['find'];

export function contextFinding(find: ModelLookup): ExtensionContext {
  const modelRegistry: Pick<ExtensionContext['modelRegistry'], 'find'> = { find };
  return { modelRegistry } as unknown as ExtensionContext;
}
