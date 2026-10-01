const reasons = {
  'user-cancel': 'user_cancel',
  'remote-cancel': 'remote_cancel',
  shutdown: 'shutdown',
  interrupt: 'interrupt',
  'turn-abort': 'interrupt',
  background: 'background',
  'recovery-timeout': 'recovery_timeout',
  'permission-stop': 'turn_teardown',
  'server-fallback-tombstone': 'server_fallback_tombstone',
  'subagent-park': 'subagent_park',
  unknown: 'turn_teardown',
} as const;
const userInitiated = new Set<string>(['user_cancel', 'remote_cancel', 'shutdown', 'interrupt', 'background', 'subagent_park']);

export type AbortReason = keyof typeof reasons;
export type AbortInfo = Readonly<{ reason: AbortReason; telemetry: string; userInitiated: boolean; cutoffNote?: string }>;

export function normalizeAbortReason(value: unknown): AbortReason {
  const raw = value instanceof DOMException && value.name === 'AbortError' ? value.message : value;
  return typeof raw === 'string' && Object.hasOwn(reasons, raw) ? (raw as AbortReason) : 'unknown';
}

export function abortInfo(value: unknown, foreground: boolean): AbortInfo {
  const reason = normalizeAbortReason(value);
  const telemetry = reasons[reason];
  return {
    reason,
    userInitiated: userInitiated.has(telemetry),
    telemetry: foreground ? (reason === 'permission-stop' ? 'permission_stop_sync' : 'user_cancel_sync') : telemetry,
    ...(foreground && reason === 'permission-stop' ? { cutoffNote: 'Agent stopped because permission was denied.' } : {}),
  };
}
