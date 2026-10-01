import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { parentIntent, seedParentIntent } from '../src/subagents/parent-intent.ts';

type Entry = ReturnType<SessionManager['getBranch']>[number];

let sequence = 0;
function message(customType: string, content: string): Entry {
  sequence += 1;
  return { type: 'custom_message', id: `entry-${sequence}`, parentId: null, timestamp: '2026-01-01T00:00:00.000Z', customType, content, display: false };
}

test('only the latest plan-mode context from the parent branch is inherited', () => {
  const branch = [message('plan-mode-context', 'first plan'), message('unrelated-context', 'ignore me'), message('plan-mode-context', 'second plan')];
  expect(parentIntent(branch)).toEqual([{ customType: 'plan-mode-context', content: 'second plan' }]);
});

test('a branch without intent messages inherits nothing', () => {
  expect(parentIntent([message('unrelated-context', 'x')])).toEqual([]);
});

test('seeding writes each inherited message into the child as hidden context', () => {
  const child = SessionManager.inMemory();
  seedParentIntent(child, [message('plan-mode-context', 'PLAN')]);
  const written = child.getEntries().flatMap((entry) => (entry.type === 'custom_message' ? [{ customType: entry.customType, content: entry.content, display: entry.display }] : []));
  expect(written).toEqual([{ customType: 'plan-mode-context', content: 'PLAN', display: false }]);
});
