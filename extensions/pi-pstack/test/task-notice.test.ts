import { expect, test } from 'vitest';
import { backgroundNotice } from '../src/task/tool.ts';

const plan = { agent: { type: 'generalPurpose' }, agentId: '11111111-2222-4333-8444-555555555555', workspace: '/w' } as unknown as Parameters<typeof backgroundNotice>[0];
const ctx = { mode: 'json', hasUI: false } as unknown as Parameters<typeof backgroundNotice>[3];

test('a background completion is titled by the first line of its prompt, as Cursor titles it, and keeps the description for the UI', () => {
  const notice = backgroundNotice(plan, 'Audit the skill corpus.\nReport every broken link.', 'Audit skill corpus', ctx, 'call-1');
  expect([notice.title, notice.description]).toEqual(['Audit the skill corpus.', 'Audit skill corpus']);
});

test('a long first line is cut at 80 characters', () => {
  expect(backgroundNotice(plan, 'x'.repeat(400), 'd', ctx, 'call-1').title).toBe('x'.repeat(80));
});
