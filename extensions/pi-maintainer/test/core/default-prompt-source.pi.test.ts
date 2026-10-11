import { getCurrentSystemPrompt } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
import piMaintainer from '../../src/index.ts';
import { piSessionFixture, promptAndSettle } from '../support/pi-session.ts';

test('the default factory projects a provider request with E7 prompts', async () => {
  const f = await piSessionFixture({ extension: piMaintainer });
  f.replies.push({ text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'hello');
  expect(restore(session.sessionManager.getBranch()).snapshot?.lifecycle).toMatchObject({ kind: 'idle' });
  expect(f.requests).toHaveLength(1);
  expect(getCurrentSystemPrompt(f.requests[0]?.messages ?? [])).toContain('Act as an expert software developer');
  expect(f.errors).toEqual([]);
});
