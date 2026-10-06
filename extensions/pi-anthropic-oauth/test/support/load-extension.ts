import type { Provider } from '@earendil-works/pi-ai';
import type { ProviderConfig, ToolInfo } from '@earendil-works/pi-coding-agent';
import type { GuardContext, GuardEvent } from '../../src/context/guard.ts';
import type { ExtensionHost } from '../../src/index.ts';

export type BeforeAgentStartHandler = (event: GuardEvent, ctx: GuardContext) => unknown;

/** Per-test overrides for the host surface the guard reads. */
export interface CaptureOptions {
  readonly tools?: readonly ToolInfo[];
  readonly activeTools?: readonly string[];
  readonly settings?: { readonly compaction?: { readonly enabled?: boolean } };
}

export interface CapturedExtension {
  readonly provider: Provider;
  readonly api: ExtensionHost;
  /** Every event name passed to `on`, in registration order. */
  readonly events: readonly string[];
  readonly entries: readonly { readonly customType: string; readonly data: unknown }[];
  beforeAgentStart(): BeforeAgentStartHandler | undefined;
}

function invoke(handler: unknown, args: readonly unknown[]): unknown {
  if (typeof handler !== 'function') return undefined;
  return Reflect.apply(handler, undefined, [...args]);
}

// Runs a factory against a fake host that records provider registrations,
// event handlers, and appended entries. Pi's public discovery path is covered
// separately in registration.test.ts.
export function captureExtension(factory: (pi: ExtensionHost) => void, options: CaptureOptions = {}): CapturedExtension {
  const providers: Provider[] = [];
  const handlers = new Map<string, unknown>();
  const events: string[] = [];
  const entries: { customType: string; data: unknown }[] = [];
  const api: ExtensionHost = {
    registerProvider: (first: Provider | string, config?: ProviderConfig): void => {
      if (typeof first === 'string') throw new Error(`legacy registerProvider(${JSON.stringify(first)}, config) is not supported, received ${config === undefined ? 'no config' : 'a config'}`);
      providers.push(first);
    },
    on: (...args: unknown[]): (() => void) => {
      const [event, handler] = args;
      if (typeof event === 'string' && typeof handler === 'function') {
        events.push(event);
        handlers.set(event, handler);
      }
      return () => undefined;
    },
    appendEntry: (customType: string, data?: unknown): void => {
      entries.push({ customType, data });
    },
    getAllTools: () => [...(options.tools ?? [])],
    getActiveTools: () => [...(options.activeTools ?? [])],
    getSettings: () => options.settings ?? {},
  };
  factory(api);
  const [only] = providers;
  if (providers.length !== 1 || !only) throw new Error(`expected one native provider registration, received ${providers.length}`);
  return {
    provider: only,
    api,
    events,
    entries,
    beforeAgentStart: () => {
      const handler = handlers.get('before_agent_start');
      return handler === undefined ? undefined : (event, ctx) => invoke(handler, [event, ctx]);
    },
  };
}

export function captureProvider(factory: (pi: ExtensionHost) => void): Provider {
  return captureExtension(factory).provider;
}
