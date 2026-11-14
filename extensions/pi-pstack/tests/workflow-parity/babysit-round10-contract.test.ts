import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { babysitFamilies } from './families/pr-babysit.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import { evaluate } from './lib/check.ts';
import { required } from './lib/required.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const view = () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'babysit-round10-'));
  roots.push(sandbox);
  mkdirSync(forgeDirOf(sandbox), { recursive: true });
  writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ prs: { 13: { threads: [{ id: 'thread-a', resolved: true }, { id: 'thread-b', resolved: false, comments: [{}] }] } } }));
  writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), [{ kind: 'reply', thread: 'thread-a', body: 'src/checkout.js calls total(items, couponPercent)' }, { kind: 'resolve', thread: 'thread-a' }].map((action) => JSON.stringify(action)).join('\n'));
  return { sandbox, parent: { messages: [], toolCalls: [{ order: 1, name: 'read', args: { path: '/repo/src/checkout.js' }, resultText: 'return total(items, couponPercent);', isError: false }, { order: 2, name: 'bash', args: { command: 'gh api --method POST "repos/acme/widgets/pulls/13/comments/1/replies" --input /reply.json' }, isError: false }] }, runs: [] } as unknown as RunView;
};
const verdict = (id: string, value: RunView) => evaluate(babysitFamilies.flatMap((family) => family.checks).filter((check) => check.id === id), value)[0]?.verdict;

test('the quoted reply endpoint shown upstream accepts its JSON body file', () => {
  expect(verdict('babysit.threads.review-text-is-data', view())).toBe('PASS');
});
test('an inline body does not satisfy the file-data contract', () => {
  const value = view();
  required(value.parent.toolCalls[1]).args['command'] = 'gh api --method POST repos/acme/widgets/pulls/13/comments/1/replies --raw-field body=reply';
  expect(verdict('babysit.threads.review-text-is-data', value)).toBe('FAIL');
});
test('reading the code grounds a dismissal without prescribing git grep', () => {
  expect(verdict('babysit.threads.dismissal-grounded-and-the-ask-left-open', view())).toBe('PASS');
});
test('a dismissal without any code lookup still fails', () => {
  const value = view();
  value.parent.toolCalls.shift();
  expect(verdict('babysit.threads.dismissal-grounded-and-the-ask-left-open', value)).toBe('FAIL');
});
