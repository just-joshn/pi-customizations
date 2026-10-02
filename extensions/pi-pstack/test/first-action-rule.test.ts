import { join } from 'node:path';

import type { Context } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { fixture, lastRequest, packageRoot, prompt } from './session-fixture.ts';

const RULE_MARKER = 'your first tool call must read the matching playbook';
const playbooks = join(packageRoot, 'skills', 'poteto-mode', 'playbooks');

function userTexts(request: Context): string[] {
  return request.messages.flatMap((message) => {
    if (message.role !== 'user') return [];
    return typeof message.content === 'string' ? [message.content] : message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  });
}

function ruleIn(request: Context): string | undefined {
  return userTexts(request).find((text) => text.includes(RULE_MARKER));
}

test('an Anthropic model in poteto mode is told to read the playbook and open a todolist first', async () => {
  const f = await fixture({ extensionOnly: true, api: 'anthropic-messages' });
  try {
    const { session } = await f.open();
    await prompt(session, '/poteto-mode Add a flag to the CLI.');
    const rule = ruleIn(lastRequest(f.requests));
    expect(rule).toContain(`in ${playbooks}`);
    expect(rule).toContain('feature.md');
    expect(rule).toContain('bug-fix.md');
    expect(rule).toContain('TodoWrite');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a later prompt in the same poteto session carries the rule again', async () => {
  const f = await fixture({ extensionOnly: true, api: 'anthropic-messages' });
  try {
    const { session } = await f.open();
    await prompt(session, '/poteto-mode Start.');
    await prompt(session, 'Now fix the failing test.');
    const rules = userTexts(lastRequest(f.requests)).filter((text) => text.includes(RULE_MARKER));
    expect(rules).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test('a model from another API family gets no rule in poteto mode', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const { session } = await f.open();
    await prompt(session, '/poteto-mode Add a flag to the CLI.');
    expect(userTexts(lastRequest(f.requests)).join('\n')).toContain('Add a flag to the CLI.');
    expect(ruleIn(lastRequest(f.requests))).toBeUndefined();
  } finally {
    await f.close();
  }
});

test('an Anthropic model gets no rule once poteto mode is off', async () => {
  const f = await fixture({ extensionOnly: true, api: 'anthropic-messages' });
  try {
    const { session } = await f.open();
    await prompt(session, '/poteto-mode Start.');
    await prompt(session, '/poteto-mode off', { startsRun: false });
    await prompt(session, 'A casual question.');
    const request = lastRequest(f.requests);
    expect(userTexts(request).join('\n')).toContain('A casual question.');
    expect(userTexts(request).filter((text) => text.includes(RULE_MARKER))).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test('an Anthropic model that never enabled poteto mode gets no rule', async () => {
  const f = await fixture({ extensionOnly: true, api: 'anthropic-messages' });
  try {
    const { session } = await f.open();
    await prompt(session, 'Just a question.');
    expect(userTexts(lastRequest(f.requests)).join('\n')).toContain('Just a question.');
    expect(ruleIn(lastRequest(f.requests))).toBeUndefined();
  } finally {
    await f.close();
  }
});
