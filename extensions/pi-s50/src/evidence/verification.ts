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
];

export function redact(text: string): string {
  return PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}
