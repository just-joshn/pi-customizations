import { AuthenticationError, CursorSdkError, IntegrationNotConnectedError, type RunError } from '@cursor/sdk';

const SIGN_IN_HINT = 'Run /login and choose Cursor (X subscription), or set CURSOR_API_KEY.';

/** A readable message for an SDK error, with the code, request ID, and help link the SDK docs say to surface. */
export function describeCursorError(error: unknown): string {
  if (!(error instanceof CursorSdkError)) return error instanceof Error ? error.message : String(error);
  const details = [error.code && `code ${error.code}`, error.status && `HTTP ${error.status}`, error.requestId && `request ${error.requestId}`].filter(Boolean);
  const parts = [
    `Cursor ${error.name}: ${error.message}`,
    ...(details.length > 0 ? [`(${details.join(', ')})`] : []),
    ...(error instanceof IntegrationNotConnectedError ? [error.helpUrl] : []),
    ...(error instanceof AuthenticationError ? [SIGN_IN_HINT] : []),
  ];
  return parts.join(' ');
}

export function describeRunError(error: RunError | undefined, requestId: string | undefined): string {
  const detail = [error?.code && `code ${error.code}`, requestId && `request ${requestId}`].filter(Boolean).join(', ');
  return `Cursor run failed: ${error?.message ?? 'unknown error'}${detail ? ` (${detail})` : ''}`;
}
