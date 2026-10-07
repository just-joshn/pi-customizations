import type { VerificationMethod } from '../domain/graph.ts';
import type { ConsumerKind, HostCapabilities } from '../domain/run.ts';

export type ConsumerRoute =
  | { readonly kind: 'agent_browser' }
  | { readonly kind: 'drive_executable' }
  | { readonly kind: 'protocol_request' }
  | { readonly kind: 'public_api' }
  | { readonly kind: 'native_automation' }
  | { readonly kind: 'inconclusive'; readonly missing: string };

export function routeConsumer(kind: ConsumerKind, capabilities: HostCapabilities): ConsumerRoute {
  switch (kind) {
    case 'browser':
    case 'electron':
      return capabilities.browserDriver ? { kind: 'agent_browser' } : { kind: 'inconclusive', missing: `${kind} driver (agent-browser) unavailable` };
    case 'cli':
    case 'tui':
      return { kind: 'drive_executable' };
    case 'http':
    case 'rpc':
      return { kind: 'protocol_request' };
    case 'library':
      return { kind: 'public_api' };
    case 'native':
      return capabilities.nativeAutomation ? { kind: 'native_automation' } : { kind: 'inconclusive', missing: 'native automation unavailable' };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

const CONSUMER_METHODS: { readonly [K in ConsumerKind]: VerificationMethod } = {
  browser: 'browser',
  electron: 'browser',
  cli: 'cli',
  tui: 'cli',
  http: 'http',
  rpc: 'http',
  library: 'library',
  native: 'native',
};

export function consumerMethod(kind: ConsumerKind): VerificationMethod {
  return CONSUMER_METHODS[kind];
}

const REDACTED = '<REDACTED>';

const PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/(Authorization:\s*)[^\r\n]+/gi, `$1${REDACTED}`],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bxox[bp]-[A-Za-z0-9-]+/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/(password\s*[=:]\s*)[^\s&"']+/gi, `$1${REDACTED}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
];

export function redact(text: string): string {
  return PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}

export function redactValue(value: unknown, keep: ReadonlySet<string>): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keep));
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, keep.has(key) ? item : redactValue(item, keep)]));
  return value;
}
