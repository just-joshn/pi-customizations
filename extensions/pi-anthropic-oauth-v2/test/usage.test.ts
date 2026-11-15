import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, test, vi } from 'vitest';
import extension from '../src/index.ts';

type Command = Parameters<ExtensionAPI['registerCommand']>[1];
const NOW = Date.parse('2026-11-15T12:00:00Z');

function usageCommand(): Command {
  const commands = new Map<string, Command>();
  extension({ registerProvider: () => {}, registerCommand: (name, command) => commands.set(name, command) });
  const command = commands.get('claude-usage');
  if (!command) throw new Error(`expected /claude-usage, got ${[...commands.keys()].join(', ')}`);
  return command;
}

async function runUsage(apiKey: string | undefined, response: Response | Error) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fetch);
  const notify = vi.fn();
  const ctx = {
    hasUI: true,
    ui: { notify },
    modelRegistry: { getProviderAuth: async (id: string) => (id === 'anthropic-oauth-v2' && apiKey ? { auth: { apiKey } } : undefined) },
  } as unknown as ExtensionCommandContext;
  await usageCommand().handler('', ctx);
  expect(notify).toHaveBeenCalledOnce();
  const [text, level] = notify.mock.calls[0] ?? [];
  return { text, level, fetch };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (kind: string, group: string, percent: number, resetsAt: string | null, extra: Record<string, unknown> = {}) => ({
  kind,
  group,
  percent,
  resets_at: resetsAt,
  severity: 'normal',
  is_active: false,
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('/claude-usage', () => {
  test('asks the Claude usage endpoint with the stored subscription token', async () => {
    const { fetch } = await runUsage('sk-ant-oat01-token', json({ limits: [] }));

    expect(fetch).toHaveBeenCalledWith('https://api.anthropic.com/api/oauth/usage', expect.objectContaining({ headers: { Authorization: 'Bearer sk-ant-oat01-token', 'anthropic-beta': 'oauth-2025-04-20' } }));
  });

  test("shows each of the server's limit rows with its reset time", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const { text, level } = await runUsage(
      'sk-ant-oat01-token',
      json({
        limits: [row('session', 'session', 12.5, '2026-11-15T15:20:00Z'), row('weekly_all', 'weekly', 40, '2026-11-18T12:00:00Z'), row('weekly_scoped', 'weekly', 3, null, { scope: { model: { display_name: 'Fable' } } })],
      }),
    );

    expect(level).toBe('info');
    expect(text).toBe(['Current session: 12.5% used, resets in 3h 20m', 'Current week (all models): 40% used, resets in 3d 0h 0m', 'Current week (Fable): 3% used'].join('\n'));
  });

  test('warns when the server marks any row above normal', async () => {
    const { text, level } = await runUsage('sk-ant-oat01-token', json({ limits: [row('session', 'session', 92, null, { severity: 'warning' })] }));

    expect(level).toBe('warning');
    expect(text).toBe('Current session: 92% used');
  });

  test('falls back to the older usage windows when limits is absent', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const { text } = await runUsage('sk-ant-oat01-token', json({ five_hour: { utilization: 7, resets_at: '2026-11-15T12:45:00Z' }, seven_day: { utilization: 51, resets_at: null }, seven_day_opus: null }));

    expect(text).toBe(['Current session: 7% used, resets in 45m', 'Current week (all models): 51% used'].join('\n'));
  });

  test('says so when the plan reports no limits', async () => {
    await expect(runUsage('sk-ant-oat01-token', json({ limits: [] }))).resolves.toMatchObject({ text: 'Claude reported no usage limits for this plan.', level: 'info' });
  });

  test.for([
    { name: 'no login', apiKey: undefined },
    { name: 'a non-OAuth key', apiKey: 'sk-ant-api03-key' },
  ])('sends nothing without a subscription login: $name', async ({ apiKey }) => {
    const { text, level, fetch } = await runUsage(apiKey, json({ limits: [] }));

    expect(level).toBe('error');
    expect(text).toContain('/login');
    expect(fetch).not.toHaveBeenCalled();
  });

  test.for([
    { status: 401, message: 'Claude rejected the login (HTTP 401). Run /login and choose Anthropic (Claude subscription, OAuth).' },
    { status: 429, message: 'Claude usage check failed (HTTP 429).' },
  ])('reports HTTP $status', async ({ status, message }) => {
    await expect(runUsage('sk-ant-oat01-token', new Response('no', { status }))).resolves.toMatchObject({ text: message, level: 'error' });
  });

  test('reports a body it cannot read', async () => {
    await expect(runUsage('sk-ant-oat01-token', json({ limits: 'soon' }))).resolves.toMatchObject({ text: 'Claude returned usage Pi cannot read.', level: 'error' });
  });

  test('reports a network failure', async () => {
    await expect(runUsage('sk-ant-oat01-token', new Error('getaddrinfo ENOTFOUND'))).resolves.toMatchObject({ text: 'getaddrinfo ENOTFOUND', level: 'error' });
  });
});
