import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { fixture, prompt, section } from './session-fixture.ts';

const reminder = "New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

test('the injected mode section begins with the upstream reminder and the reminder is gone after off', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const { session } = await f.open();
    await prompt(session, '/poteto-mode Analyze this task.');
    expect(section(f.requests, 'pstack_mode')).toBeNull();
    await prompt(session, 'Continue the task.');
    expect(section(f.requests, 'pstack_mode')).toBeNull();

    await prompt(session, '/poteto-mode sticky Analyze this task.');
    expect(section(f.requests, 'pstack_mode')?.startsWith(`<pstack_mode>\n${reminder}\n\nReferences are relative to `)).toBe(true);
    await prompt(session, 'Continue the sticky task.');
    expect(section(f.requests, 'pstack_mode')?.startsWith(`<pstack_mode>\n${reminder}`)).toBe(true);
    await prompt(session, '/poteto-mode off', { startsRun: false });
    await prompt(session, 'A casual question.');
    expect(section(f.requests, 'pstack_mode')).toBeNull();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('the mode status shows the upstream display name, crown icon, and the warning color while the mode is on', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const { session } = await f.open();
    const statuses: (string | undefined)[] = [];
    const theme = { fg: (role: string, text: string) => `<${role}>${text}</${role}>`, bold: (text: string) => text };
    const uiContext = { setStatus: (key: string, text: string | undefined) => key === 'pstack' && statuses.push(text), setWidget() {}, notify() {}, theme } as unknown as ExtensionUIContext;
    await session.bindExtensions({ uiContext, mode: 'tui' });
    expect(statuses.at(-1)).toBeUndefined();
    await prompt(session, '/poteto-mode Analyze this task.');
    expect(statuses.at(-1)).toBeUndefined();
    await prompt(session, '/poteto-mode sticky Analyze this task.');
    expect(statuses.at(-1)).toBe('<warning>👑 Poteto Mode</warning>');
    await prompt(session, '/poteto-mode off', { startsRun: false });
    expect(statuses.at(-1)).toBeUndefined();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('outside the TUI the mode status keeps the name and icon without reading the uninitialized theme', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const { session } = await f.open();
    const statuses: (string | undefined)[] = [];
    const uiContext = {
      setStatus: (key: string, text: string | undefined) => key === 'pstack' && statuses.push(text),
      setWidget() {},
      notify() {},
      theme: new Proxy(
        {},
        {
          get() {
            throw new Error('Theme not initialized. Call initTheme() first.');
          },
        },
      ),
    } as unknown as ExtensionUIContext;
    await session.bindExtensions({ uiContext, mode: 'rpc' });
    await prompt(session, '/poteto-mode sticky Analyze this task.');
    expect(statuses.at(-1)).toBe('👑 Poteto Mode');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
