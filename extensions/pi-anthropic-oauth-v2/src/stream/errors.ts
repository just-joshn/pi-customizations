import Anthropic from '@anthropic-ai/sdk';

export function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    const status = error.status === undefined ? '' : ` ${error.status}`;
    const request = error.requestID ? ` (request ${error.requestID})` : '';
    return `${error.name}${status}${request}: ${error.apiMessage ?? error.message}`;
  }
  return error instanceof Error ? error.message : JSON.stringify(error);
}
