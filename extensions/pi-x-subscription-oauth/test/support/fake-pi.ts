import type { Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext, ExtensionVirtualModel, ProviderConfig } from '@earendil-works/pi-coding-agent';

type Registering = Pick<ExtensionAPI, 'registerProvider' | 'registerVirtualModel' | 'registerCommand'>;

export type RegisteredCommandCapture = {
  readonly name: string;
  readonly description?: string | undefined;
};

export type Registrations = {
  readonly providers: readonly Provider[];
  readonly virtualModels: readonly ExtensionVirtualModel[];
  readonly commands: readonly RegisteredCommandCapture[];
};

export function register(factory: (pi: Registering) => void): Registrations {
  const providers: Provider[] = [];
  const virtualModels: ExtensionVirtualModel[] = [];
  const commands: RegisteredCommandCapture[] = [];
  const registerProvider = (first: Provider | string, config?: ProviderConfig): void => {
    if (typeof first === 'string') throw new Error(`legacy registerProvider(${JSON.stringify(first)}, config) is not supported, received ${config === undefined ? 'no config' : 'a config'}`);
    providers.push(first);
  };
  const registerVirtualModel = (model: ExtensionVirtualModel): void => {
    virtualModels.push(model);
  };
  const registerCommand: ExtensionAPI['registerCommand'] = (name, options) => {
    commands.push({ name, ...(options.description !== undefined ? { description: options.description } : {}) });
  };
  factory({ registerProvider, registerVirtualModel, registerCommand });
  return { providers, virtualModels, commands };
}

export function providerNamed(registrations: Registrations, id: string): Provider {
  const found = registrations.providers.find((provider) => provider.id === id);
  if (!found) throw new Error(`missing provider ${id}`);
  return found;
}

type ModelLookup = ExtensionContext['modelRegistry']['find'];

export function contextFinding(find: ModelLookup): ExtensionContext {
  const modelRegistry: Pick<ExtensionContext['modelRegistry'], 'find'> = { find };
  return { modelRegistry } as unknown as ExtensionContext;
}
