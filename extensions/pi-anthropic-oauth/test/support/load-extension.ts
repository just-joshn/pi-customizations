import type { Provider } from '@earendil-works/pi-ai';
import { createEventBus, createExtensionRuntime, type EventBus, type Extension, type ExtensionFactory, type ExtensionRuntime } from '@earendil-works/pi-coding-agent';

interface FactoryLoader {
  loadExtensionFromFactory(factory: ExtensionFactory, cwd: string, eventBus: EventBus, runtime: ExtensionRuntime): Promise<Extension>;
}

export interface NativeRegistration {
  readonly provider: Provider;
  readonly extensionPath: string;
}

export interface LoadedExtension {
  readonly extension: Extension;
  readonly registrations: readonly NativeRegistration[];
}

// Pi's package exports map hides loadExtensionFromFactory, so the loader module is
// addressed through the resolved package entry. It is the same module Pi itself runs.
async function importFactoryLoader(): Promise<FactoryLoader> {
  const entry = import.meta.resolve('@earendil-works/pi-coding-agent');
  const loaderModule: Record<string, unknown> = await import(new URL('./core/extensions/loader.js', entry).href);
  const load = loaderModule.loadExtensionFromFactory;
  if (typeof load !== 'function') throw new Error('Pi no longer exposes loadExtensionFromFactory from core/extensions/loader.js');
  return { loadExtensionFromFactory: (...args) => load(...args) };
}

export async function loadExtension(factory: ExtensionFactory): Promise<LoadedExtension> {
  const loader = await importFactoryLoader();
  const runtime = createExtensionRuntime();
  const extension = await loader.loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime);
  return { extension, registrations: [...runtime.pendingNativeProviderRegistrations] };
}

export async function loadProvider(factory: ExtensionFactory): Promise<Provider> {
  const { registrations } = await loadExtension(factory);
  const [first] = registrations;
  if (registrations.length !== 1 || !first) throw new Error(`expected one native provider registration, received ${registrations.length}`);
  return first.provider;
}
