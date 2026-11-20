import { getSdkEvents, recordCall, recordClientOptions } from './sdk-state.ts';

type SdkModule = typeof import('@anthropic-ai/sdk');

async function* replayEvents() {
  yield* getSdkEvents();
}

const create = async (params: Record<string, unknown>, request: { signal?: unknown }) => {
  recordCall(params, request.signal);
  return replayEvents();
};

/** Replaces the Anthropic client with one that records its calls and replays the scripted events. */
export function createSdkMock(actual: SdkModule) {
  class FakeAnthropic {
    static readonly APIError = actual.APIError;
    readonly beta = { messages: { create } };
    constructor(options: Record<string, unknown>) {
      recordClientOptions(options);
    }
  }
  return { ...actual, default: FakeAnthropic };
}
