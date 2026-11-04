import { expect, test } from 'vitest';
import { backgroundNotice } from '../src/task/tool.ts';

const plan = { agent: { type: 'generalPurpose' }, agentId: '11111111-2222-4333-8444-555555555555', workspace: '/w' } as unknown as Parameters<typeof backgroundNotice>[0];
const ctx = { mode: 'json', hasUI: false } as unknown as Parameters<typeof backgroundNotice>[2];

test('a background completion notice names the subagent by its Task description, as Cursor names it in the UI', () => {
  expect(backgroundNotice(plan, 'Audit skill corpus', ctx, 'call-1').title).toBe('Audit skill corpus');
});

test('a description over the title limit is flattened and cut with an ellipsis', () => {
  const long = `line one\n${'x'.repeat(400)}`;
  const title = backgroundNotice(plan, long, ctx, 'call-1').title;
  expect([title.startsWith('line one xxx'), title.endsWith('…'), title.length]).toEqual([true, true, 201]);
});
