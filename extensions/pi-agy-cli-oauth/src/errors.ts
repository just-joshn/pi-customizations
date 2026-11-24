import { z } from 'zod';

/**
 * Set to a truthy value to keep an account-block notice as ordinary assistant
 * text. Unset, that notice becomes a non-retryable error.
 */
export const POLICY_ALLOW_ENV = 'PI_AGY_ALLOW_POLICY';

/** The only account URL this extension has observed the CLI point at. */
const ACCOUNT_URL = 'https://antigravity.google';

/**
 * Pi's retry classifier only retries a message that matches a transient-provider
 * phrase such as "rate limit" or "503", so these must avoid one. They do not:
 * an account block is deterministic, and retrying it burns quota for nothing.
 */
const TOS_MESSAGE =
  'Antigravity disabled this account for a Terms of Service violation. ' + `This is an account policy block rather than a temporary failure, so Pi stopped without retrying. ` + `Check the account at ${ACCOUNT_URL} and submit an appeal.`;

const INTERNAL_MESSAGE = 'Google internal policy blocked this request, and the CLI reports that no user can approve it. ' + `Pi stopped without retrying.`;

const ENTERPRISE_MESSAGE = 'An enterprise policy setting disabled gateway authentication, so the account cannot serve this request. ' + `Ask the administrator whether gateway.enabled is permitted, then retry.`;

const TOS_NEEDLE = 'disabled in this account for violation of Terms of Service';
const INTERNAL_NEEDLE = 'blocked by Google internal policy';
const ENTERPRISE_NEEDLE = 'Gateway authentication is disabled by enterprise policy';

const exitCodeSchema = z.object({ exitCode: z.number().optional(), signal: z.string().optional() });

/** Non-retryable, actionable error text for a policy rejection, or undefined. */
export function policyRejection(message: string): string | undefined {
  if (message.includes(TOS_NEEDLE)) return TOS_MESSAGE;
  if (message.includes(INTERNAL_NEEDLE)) return INTERNAL_MESSAGE;
  if (message.includes(ENTERPRISE_NEEDLE)) return ENTERPRISE_MESSAGE;
  return undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const parsed = z.object({ message: z.string() }).safeParse(error);
  if (parsed.success) return parsed.data.message;
  return 'Antigravity CLI request failed';
}

function exitNote(error: unknown): string | undefined {
  const parsed = exitCodeSchema.safeParse(error);
  if (!parsed.success) return undefined;
  if (parsed.data.exitCode !== undefined) return `process exit ${parsed.data.exitCode}`;
  if (parsed.data.signal !== undefined) return `process exit signal ${parsed.data.signal}`;
  return undefined;
}

/** The Pi error message for an ACP JSON-RPC error or a thrown transport failure. */
export function transportFailure(error: unknown, stderrTail: string): string {
  const tail = stderrTail.trim();
  const detail = errorText(error);
  const body = tail === '' ? detail : `${detail}\n${tail}`;
  if (/exit/i.test(body)) return body;
  const note = exitNote(error);
  return note === undefined ? body : `${body} (${note})`;
}
