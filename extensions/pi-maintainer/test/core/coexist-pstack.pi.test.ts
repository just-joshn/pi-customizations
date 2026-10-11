import { getCurrentSystemPrompt } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import piMaintainer from '../../src/index.ts';
import { textOf } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle } from '../support/pi-session.ts';

const skillPrompt = `<skill name="poteto-mode" location="/pkg/skills/poteto-mode/SKILL.md">
# Poteto mode
Use Task agents.
</skill>

hello from coexist`;

test('with pstack loaded, session keeps skill delivery while maintainer strips it from the provider request', async () => {
  const pstack = (await import('../../../pi-pstack/src/index.ts')).default;
  const f = await piSessionFixture({ extension: piMaintainer, before: [pstack] });
  f.replies.push({ text: '' });
  const session = await f.open();
  await promptAndSettle(session, skillPrompt);

  const users = session.sessionManager
    .getBranch()
    .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
    .map((entry) => textOf(entry.message));
  expect(users.some((text) => text.includes('<skill name="poteto-mode"'))).toBe(true);
  expect(users.some((text) => text.includes('hello from coexist'))).toBe(true);

  expect(f.requests).toHaveLength(1);
  const requestText = (f.requests[0]?.messages ?? []).map(textOf).join('\n');
  expect(requestText).toContain('hello from coexist');
  expect(requestText).not.toContain('<skill');
  expect(requestText).not.toContain('Use Task agents');
  const systemPrompt = getCurrentSystemPrompt(f.requests[0]?.messages ?? []);
  expect(systemPrompt).not.toMatch(/Use Task agents/);
  // pstack may still arm gates from event.prompt; its usage sections must not replace Aider ownership
  expect(systemPrompt).toMatch(/Act as an expert software developer/);
  expect(systemPrompt).not.toMatch(/pstack_poteto_playbook_todos|TodoWrite of the matched playbook/);
  expect(f.errors).toEqual([]);
});
