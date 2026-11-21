import { beforeEach, describe, expect, test, vi } from 'vitest';
import { type Script, sdk, sdkText } from './fake-sdk.ts';
import { loadExtension, makeContext } from './host.ts';
import { ask, freshPrompt, system, user } from './stream-helpers.ts';

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

const MAX_IDLE_AGENTS = 16;

const answer =
  (text: string): Script =>
  async ({ emit }) => {
    emit(sdkText(text));
    return { status: 'finished' };
  };

/** The pool outlives one extension instance, so each test starts from the empty pool a fresh session has. */
beforeEach(async () => {
  sdk.reset();
  await loadExtension().fire('session_shutdown', {}, makeContext().ctx);
});

describe('idle Cursor agents between runs', () => {
  test('finishing the same conversation twice closes the agent the second one replaces', async () => {
    sdk.script(answer('Same answer.'), answer('Same answer.'));
    const history = [system(freshPrompt()), user('one')];
    await ask(history);
    await ask(history);
    const [replaced, kept] = sdk.agents;
    expect(replaced?.close).toHaveBeenCalledTimes(1);
    expect(kept?.close).not.toHaveBeenCalled();
  });

  test('keeping more idle agents than the pool holds closes the oldest', async () => {
    sdk.script(...Array.from({ length: MAX_IDLE_AGENTS + 1 }, () => answer('Hello.')));
    for (let count = 0; count <= MAX_IDLE_AGENTS; count += 1) await ask([system(freshPrompt()), user('hi')]);
    const [oldest, ...rest] = sdk.agents;
    expect(oldest?.close).toHaveBeenCalledTimes(1);
    expect(rest.filter((agent) => agent.close.mock.calls.length > 0)).toStrictEqual([]);
  });

  test('signing in again with a new API key does not reuse an agent made with the old key', async () => {
    sdk.script(answer('First.'), answer('Second.'));
    const history = [system(freshPrompt()), user('one')];
    const first = await ask(history, { apiKey: 'old-key' });
    await ask([...history, first.message, user('two')], { apiKey: 'new-key' });
    expect(sdk.agents.map((agent) => agent.options.apiKey)).toStrictEqual(['old-key', 'new-key']);
  });
});

describe('idle Cursor agents when the session shuts down', () => {
  test('closes every idle agent', async () => {
    sdk.script(answer('Hello.'), answer('Hi.'));
    await ask([system(freshPrompt()), user('one')]);
    await ask([system(freshPrompt()), user('two')]);
    await loadExtension().fire('session_shutdown', {}, makeContext().ctx);
    expect(sdk.agents.map((agent) => agent.close.mock.calls.length)).toStrictEqual([1, 1]);
  });

  test('a follow-up after shutdown starts a fresh agent', async () => {
    sdk.script(answer('First.'), answer('Second.'));
    const history = [system(freshPrompt()), user('one')];
    const first = await ask(history);
    await loadExtension().fire('session_shutdown', {}, makeContext().ctx);
    await ask([...history, first.message, user('two')]);
    expect(sdk.agents).toHaveLength(2);
  });
});
