import type { FailureKind, ToolFailure } from '../types.ts';

/** Error thrown inside a tool when the call cannot complete. Rendered to the model, never thrown to Pi. */
export class LayerError extends Error {
  readonly failure: ToolFailure;

  constructor(failure: ToolFailure) {
    super(failure.message);
    this.name = 'LayerError';
    this.failure = failure;
  }
}

export function layerError(kind: FailureKind, message: string, extra: { path?: string; hint?: string } = {}): LayerError {
  return new LayerError({
    kind,
    message,
    ...(extra.path === undefined ? {} : { path: extra.path }),
    ...(extra.hint === undefined ? {} : { hint: extra.hint }),
  });
}

/** Model-facing text for one failure. Every call site writes a complete message that names the path. */
export function failureText(failure: ToolFailure): string {
  return failure.hint === undefined ? failure.message : `${failure.message}\n\n${failure.hint}`;
}

export function failureOutcome<TDetails>(failure: ToolFailure, details: (failure: ToolFailure) => TDetails): { content: { type: 'text'; text: string }[]; details: TDetails; isError: true } {
  return { content: [{ type: 'text', text: failureText(failure) }], details: details(failure), isError: true };
}

/** Convert any thrown value into a layer failure. */
export function toFailure(error: unknown, fallbackPath?: string): ToolFailure {
  if (error instanceof LayerError) {
    return error.failure;
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const path = fallbackPath;
  if (code === 'ENOENT') {
    return { kind: 'file_not_found', message, ...(path === undefined ? {} : { path }) };
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { kind: 'permission_denied', message: `Permission denied: ${path ?? message}`, ...(path === undefined ? {} : { path }) };
  }
  if (code === 'ENOSPC') {
    return { kind: 'no_space', message, ...(path === undefined ? {} : { path }) };
  }
  if (code === 'EBUSY') {
    return { kind: 'file_busy', message, ...(path === undefined ? {} : { path }) };
  }
  return { kind: 'error', message, ...(path === undefined ? {} : { path }) };
}
