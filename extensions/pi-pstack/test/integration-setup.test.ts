import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { roleNames } from '../src/models.ts';
import { fixture, lastRequest, prompt, section } from './session-fixture.ts';

test('setup-pstack delivers the skill to the model in interactive and headless sessions', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, '/setup-pstack');
    const delivered = JSON.stringify(lastRequest(f.requests).messages);
    expect(delivered).toContain(String.raw`<skill name=\"setup-pstack\"`);
    await prompt(session, '/skill:setup-pstack');
    expect(JSON.stringify(lastRequest(f.requests).messages)).toContain(String.raw`<skill name=\"setup-pstack\"`);
    const errors = session.messages.filter((message) => message.role === 'custom' && message.customType === 'pstack-setup-error');
    expect(errors.length).toBe(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('setup runs as an agent turn that reads state, asks the budget, and writes the rule', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    session.extensionRunner.setUIContext(
      {
        ...session.extensionRunner.createContext().ui,
        select: async (_title: string, options: string[]) => options[0],
      },
      'rpc',
    );
    f.calls.push(
      { type: 'toolCall', id: 'setup-state', name: 'pstack_setup', arguments: { action: 'state' } },
      {
        type: 'toolCall',
        id: 'setup-ask',
        name: 'AskQuestion',
        arguments: { questions: [{ id: 'budget', prompt: 'Reasoning budget?', options: [{ id: 'unlimited — max reasoning', label: 'unlimited — max reasoning' }] }] },
      },
      {
        type: 'toolCall',
        id: 'setup-write',
        name: 'pstack_setup',
        arguments: {
          action: 'write',
          budget: 'unlimited — max reasoning',
          roleOverrides: roleNames.map((role) => ({ role, value: role === 'interrogate reviewers' ? 'pstack-integration/scripted' : 'inherit-parent' })),
        },
      },
    );
    await prompt(session, '/setup-pstack');
    expect(f.errors).toEqual([]);
    const configuration = await readFile(join(f.root, 'agent/pstack/models.mdc'), 'utf8');
    expect(configuration).toContain('# pstack model configuration. One line per role. Delete a line to fall back to the skill default.');
    expect(configuration).toMatch(/^# budget: unlimited \(max\)$/m);
    expect(configuration).toContain('interrogate reviewers: pstack-integration/scripted');
    expect(configuration).toMatch(/^feature, refactoring: inherit-parent$/m);
    await prompt(session, 'journey probe');
    expect(section(f.requests, 'pstack_host')).toContain('interrogate reviewers: pstack-integration/scripted');
    f.calls.push({ type: 'toolCall', id: 'setup-state-2', name: 'pstack_setup', arguments: { action: 'state' } });
    await prompt(session, '/setup-pstack');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});