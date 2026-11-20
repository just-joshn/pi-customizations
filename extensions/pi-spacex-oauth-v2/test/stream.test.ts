import { AuthenticationError, CursorSdkError, IntegrationNotConnectedError } from '@cursor/sdk';
import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeSdk, sdk, sdkStatus, sdkText, sdkThinking } from './fake-sdk.ts';
import { ask, call, freshPrompt, system, toolCalls, toolResult, user } from './stream-helpers.ts';

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

const HTTP_UNAUTHORIZED = 401;
const IMAGE_RESULT_TIMESTAMP = 3;
const BATCH_WAIT_MS = 30;
const MS_PER_MINUTE = 60_000;
const TOOL_WAIT_MINUTES = 30;
const SETTLE_MS = 5;
const AGENTS_AFTER_EDIT = 2;
const INTEGRATIONS_URL = 'https://cursor.com/dashboard/integrations';

beforeEach(() => sdk.reset());
afterEach(() => vi.useRealTimers());

describe('a plain reply', () => {
  test('streams thinking and text, then stops with zero usage so Pi estimates context', async () => {
    sdk.script(async ({ emit }) => {
      emit(sdkStatus());
      emit(sdkThinking('Let me '));
      emit(sdkThinking('think.'));
      emit(sdkThinking('', true));
      emit(sdkText('Hello'));
      emit(sdkText(' there'));
      return { status: 'finished' };
    });
    const { message, types } = await ask([system('plain'), user('hi')]);
    expect(types).toStrictEqual(['start', 'thinking_start', 'thinking_delta', 'thinking_delta', 'thinking_end', 'text_start', 'text_delta', 'text_delta', 'text_end', 'done']);
    expect(message.stopReason).toBe('stop');
    expect(message.content).toStrictEqual([
      { type: 'thinking', thinking: 'Let me think.' },
      { type: 'text', text: 'Hello there' },
    ]);
    expect(message.usage.totalTokens).toBe(0);
    expect(message).toMatchObject({ api: 'cursor-sdk', provider: 'spacex-cursor', model: 'composer-2.5' });
  });

  test("creates a local agent with only the MCP tool group, Pi's prompt in the message, and the catalog's default variant", async () => {
    sdk.script(async () => ({ status: 'finished' }));
    await ask([system('You are Pi.'), user('hi')]);
    const [agent] = sdk.agents;
    expect(agent?.options).toMatchObject({ apiKey: 'key', model: { id: 'composer-2.5', params: [{ id: 'fast', value: 'true' }] }, tools: ['mcp'] });
    expect(agent?.options.local?.cwd).toContain('pi-spacex-cursor');
    expect(agent?.sends[0]?.message).toStrictEqual({ text: '<system_prompt>\nYou are Pi.\n</system_prompt>\n\nhi' });
    expect(Object.keys(agent?.sends[0]?.options?.local?.customTools ?? {})).toStrictEqual(['read', 'ls']);
  });

  test('sends user images alongside the text', async () => {
    sdk.script(async () => ({ status: 'finished' }));
    const withImage = user([
      { type: 'text', text: 'what is this' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ]);
    await ask([withImage], {});
    expect(sdk.agents[0]?.options.apiKey).toBeUndefined();
    expect(sdk.agents[0]?.sends[0]?.message).toStrictEqual({ text: 'what is this\n[image]', images: [{ data: 'AAAA', mimeType: 'image/png' }] });
  });
});

describe('Pi tool calls: round trips', () => {
  test('a tool call ends the turn with toolUse, and the results resume the same Cursor run', async () => {
    let received: unknown[] = [];
    sdk.script(async ({ tools, emit }) => {
      emit(sdkText('Checking.'));
      received = await Promise.all([call(tools, 'read', { path: 'a.txt' }), call(tools, 'ls', {})]);
      emit(sdkText('Done.'));
      return { status: 'finished' };
    });
    const history = [system('tools'), user('read a.txt')];
    const first = await ask(history);
    expect(first.message.stopReason).toBe('toolUse');
    expect(first.types).toContain('toolcall_end');
    const calls = toolCalls(first.message);
    expect(calls.map((c) => [c.name, c.arguments])).toStrictEqual([
      ['read', { path: 'a.txt' }],
      ['ls', {}],
    ]);

    const image: ToolResultMessage = { role: 'toolResult', toolCallId: calls[1]?.id ?? '', toolName: 'ls', content: [{ type: 'image', data: 'BBBB', mimeType: 'image/png' }], isError: false, timestamp: IMAGE_RESULT_TIMESTAMP };
    const second = await ask([...history, first.message, toolResult(calls[0]?.id ?? '', 'file text', true), image]);
    expect(second.message.stopReason).toBe('stop');
    expect(second.message.content).toStrictEqual([{ type: 'text', text: 'Done.' }]);
    expect(received).toStrictEqual([
      { content: [{ type: 'text', text: 'file text' }], isError: true },
      { content: [{ type: 'image', data: 'BBBB', mimeType: 'image/png' }], isError: false },
    ]);
    expect(sdk.agents).toHaveLength(1);
  });

  test('a call Pi did not answer gets an error result, and an empty result gets empty text', async () => {
    let received: unknown[] = [];
    sdk.script(async ({ tools }) => {
      received = await Promise.all([call(tools, 'read', {}), call(tools, 'ls', {})]);
      return { status: 'finished' };
    });
    const history = [system('partial'), user('go')];
    const first = await ask(history);
    const [read] = toolCalls(first.message);
    const empty: ToolResultMessage = { ...toolResult(read?.id ?? '', ''), content: [] };
    await ask([...history, first.message, empty]);
    expect(received).toStrictEqual([
      { content: [{ type: 'text', text: '' }], isError: false },
      { content: [{ type: 'text', text: 'Pi returned no result for this tool call.' }], isError: true },
    ]);
  });
});

describe('Pi tool calls: backlog, timeout, and replay', () => {
  test('events that arrive while Pi runs the tool are replayed into the next turn', async () => {
    let afterPark: () => void = () => undefined;
    sdk.script(async ({ tools, emit }) => {
      const pending = call(tools, 'read', {});
      await new Promise<void>((resolve) => (afterPark = resolve));
      emit(sdkText('late'));
      await pending;
      return { status: 'finished' };
    });
    const history = [system('backlog'), user('go')];
    const first = await ask(history);
    afterPark();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const second = await ask([...history, first.message, toolResult(toolCalls(first.message)[0]?.id ?? '', 'ok')]);
    expect(second.message.content).toStrictEqual([{ type: 'text', text: 'late' }]);
  });

  test('a parked run is cancelled after the tool wait, releasing its calls', async () => {
    vi.useFakeTimers();
    let released: unknown;
    sdk.script(async ({ tools, cancelled }) => {
      void call(tools, 'read').then((r) => (released = r));
      await cancelled;
      return { status: 'cancelled' };
    });
    const pending = ask([system('timeout'), user('go')]);
    await vi.advanceTimersByTimeAsync(BATCH_WAIT_MS);
    expect((await pending).message.stopReason).toBe('toolUse');
    await vi.advanceTimersByTimeAsync(TOOL_WAIT_MINUTES * MS_PER_MINUTE);
    expect(sdk.agents[0]?.runs[0]?.cancel).toHaveBeenCalled();
    expect(released).toStrictEqual({ content: [{ type: 'text', text: 'The run ended before Pi answered this tool call.' }], isError: true });
    expect(sdk.agents[0]?.close).toHaveBeenCalled();
  });

  test('tool results with no waiting run start a fresh agent that replays the history', async () => {
    sdk.script(async () => ({ status: 'finished' }));
    const assistant = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'toolCall', id: 'gone', name: 'read', arguments: { path: 'x' } },
      ],
    } as unknown as Message;
    await ask([system('orphan'), user('look'), assistant, toolResult('gone', 'contents', true)]);
    expect(sdk.agents[0]?.sends[0]?.message).toStrictEqual({
      text: '<system_prompt>\norphan\n</system_prompt>\n\n<conversation_so_far>\nUser: look\nAssistant: Let me look.\n[called read {"path":"x"}]\n[read result, error] contents\n</conversation_so_far>\n\nContinue from the conversation above.',
    });
  });
});

describe('follow-up turns', () => {
  test('a follow-up reuses the idle agent and sends only the new message', async () => {
    sdk.script(
      async ({ emit }) => {
        emit(sdkText('First answer.'));
        return { status: 'finished' };
      },
      async () => ({ status: 'finished' }),
    );
    const history = [system('reuse'), user('one')];
    const first = await ask(history);
    await ask([...history, first.message, user('two')]);
    expect(sdk.agents).toHaveLength(1);
    expect(sdk.agents[0]?.sends.map((s) => s.message)).toStrictEqual([{ text: '<system_prompt>\nreuse\n</system_prompt>\n\none' }, { text: 'two' }]);
  });

  test('an edited history starts a fresh agent with the history as text', async () => {
    sdk.script(
      async ({ emit }) => {
        emit(sdkText('Answer A.'));
        return { status: 'finished' };
      },
      async () => ({ status: 'finished' }),
    );
    const history = [system('branch'), user('one')];
    const first = await ask(history);
    const edited = { ...first.message, content: [{ type: 'text' as const, text: 'Answer B.' }] };
    await ask([...history, edited, user('two')]);
    expect(sdk.agents).toHaveLength(AGENTS_AFTER_EDIT);
    expect(sdk.agents[1]?.sends[0]?.message).toStrictEqual({ text: '<system_prompt>\nbranch\n</system_prompt>\n\n<conversation_so_far>\nUser: one\nAssistant: Answer B.\n</conversation_so_far>\n\ntwo' });
  });
});

describe('failures: errors', () => {
  test('a failed run reports Cursor’s error with its code and request ID, and drops the agent', async () => {
    sdk.script(async () => ({ status: 'error', error: { message: 'Model not in plan', code: 'forbidden' }, requestId: 'req-1' }));
    const { message } = await ask([system('fail'), user('hi')]);
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toBe('Cursor run failed: Model not in plan (code forbidden, request req-1)');
    expect(sdk.agents[0]?.close).toHaveBeenCalled();
  });

  test('a run that fails without details still reports', async () => {
    sdk.script(async () => ({ status: 'error' }));
    expect((await ask([system('bare fail'), user('hi')])).message.errorMessage).toBe('Cursor run failed: unknown error');
  });

  test('a rejected API key asks the user to sign in again', async () => {
    sdk.failSend(new AuthenticationError('Invalid User API Key', { status: HTTP_UNAUTHORIZED, requestId: 'req-2' }));
    const { message } = await ask([system('auth'), user('hi')]);
    expect(message.errorMessage).toBe('Cursor AuthenticationError: Invalid User API Key (HTTP 401, request req-2) Run /login and choose Cursor (X subscription), or set CURSOR_API_KEY.');
    expect(sdk.agents[0]?.close).toHaveBeenCalled();
  });

  test('a stream that throws ends the turn with the error', async () => {
    sdk.script(async ({ emit }) => {
      emit(sdkText('partial'));
      throw new Error('socket closed');
    });
    const { message } = await ask([system('throw'), user('hi')]);
    expect(message).toMatchObject({ stopReason: 'error', errorMessage: 'socket closed', content: [{ type: 'text', text: 'partial' }] });
  });
});

describe('failures: aborts and create errors', () => {
  test('aborting the request cancels the Cursor run', async () => {
    const controller = new AbortController();
    sdk.script(async ({ emit, cancelled }) => {
      emit(sdkText('working'));
      setTimeout(() => controller.abort(), 1);
      await cancelled;
      return { status: 'cancelled' };
    });
    const { message } = await ask([system('abort'), user('hi')], { apiKey: 'key', signal: controller.signal });
    expect(message).toMatchObject({ stopReason: 'aborted', errorMessage: 'Cursor run was cancelled' });
    expect(sdk.agents[0]?.runs[0]?.cancel).toHaveBeenCalled();
  });

  test('aborting a request that already ended leaves the run alone', async () => {
    const controller = new AbortController();
    sdk.script(async ({ tools }) => {
      await call(tools, 'read', {});
      return { status: 'finished' };
    });
    const history = [system('stale abort'), user('go')];
    const first = await ask(history, { apiKey: 'key', signal: controller.signal });
    controller.abort();
    const second = await ask([...history, first.message, toolResult(toolCalls(first.message)[0]?.id ?? '', 'ok')]);
    expect(second.message.stopReason).toBe('stop');
    expect(sdk.agents[0]?.runs[0]?.cancel).not.toHaveBeenCalled();
  });

  test('an unknown model fails at agent creation with a readable error', async () => {
    sdk.failCreate(new Error('Cannot use this model: nope'));
    const aborted = new AbortController();
    aborted.abort();
    const { message } = await ask([system('create'), user('hi')], { signal: aborted.signal });
    expect(message).toMatchObject({ stopReason: 'aborted', errorMessage: 'Cannot use this model: nope' });
  });
});

describe('failures: how Cursor SDK errors read', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const failWith = async (error: unknown) => {
    sdk.failSend(error);
    return (await ask([system(freshPrompt()), user('hi')])).message.errorMessage;
  };

  test('a disconnected integration points to its help link', async () => {
    const error = new IntegrationNotConnectedError('github integration is not connected', { provider: 'github', helpUrl: INTEGRATIONS_URL, code: 'not_connected' });
    expect(await failWith(error)).toBe(`Cursor IntegrationNotConnectedError: github integration is not connected (code not_connected) ${INTEGRATIONS_URL}`);
  });

  test('an SDK error without details shows only its name and message', async () => {
    expect(await failWith(new CursorSdkError('bare'))).toBe('Cursor CursorSdkError: bare');
  });

  test('a plain Error shows its message', async () => {
    expect(await failWith(new Error('plain'))).toBe('plain');
  });

  test('a thrown string shows as text', async () => {
    expect(await failWith('text')).toBe('text');
  });
});

describe('the Cursor model catalog lookup', () => {
  const askWithKey = (apiKey: string | undefined, modelId = 'composer-2.5') => {
    sdk.script(async () => ({ status: 'finished' }));
    return ask([system(freshPrompt()), user('hi')], apiKey ? { apiKey } : {}, modelId);
  };

  test('asks Cursor for the catalog once per API key', async () => {
    await askWithKey('once-key');
    await askWithKey('once-key');
    await askWithKey('other-key');
    expect(fakeSdk.Cursor.models.list.mock.calls).toStrictEqual([[{ apiKey: 'once-key' }], [{ apiKey: 'other-key' }]]);
  });

  test('retries after a failed catalog read, and meanwhile sends the bare model id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeSdk.Cursor.models.list.mockRejectedValueOnce(new Error('offline'));
    await askWithKey('retry-key', 'auto');
    expect(error).toHaveBeenCalledWith('Cursor model catalog lookup failed:', expect.objectContaining({ message: 'offline' }));
    expect(sdk.agents[0]?.options.model).toStrictEqual({ id: 'auto' });
    await askWithKey('retry-key', 'auto');
    expect(fakeSdk.Cursor.models.list).toHaveBeenCalledTimes(2);
    expect(sdk.agents[1]?.options.model).toMatchObject({ id: 'default' });
    error.mockRestore();
  });
});
