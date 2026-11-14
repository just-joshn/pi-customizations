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
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const view = () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'babysit-round10-'));
  roots.push(sandbox);
  mkdirSync(forgeDirOf(sandbox), { recursive: true });
  writeFileSync(
    join(forgeDirOf(sandbox), 'state.json'),
    JSON.stringify({
      prs: {
        13: {
          threads: [
            { id: 'thread-a', resolved: true },
            { id: 'thread-b', resolved: false, comments: [{}] },
          ],
        },
      },
    }),
  );
  writeFileSync(
    join(forgeDirOf(sandbox), 'actions.jsonl'),
    [
      { kind: 'reply', thread: 'thread-a', body: 'src/checkout.js calls total(items, couponPercent)' },
      { kind: 'resolve', thread: 'thread-a' },
    ]
      .map((action) => JSON.stringify(action))
      .join('\n'),
  );
  return {
    sandbox,
    parent: {
      messages: [],
      toolCalls: [
        { order: 1, name: 'read', args: { path: '/repo/src/checkout.js' }, resultText: 'return total(items, couponPercent);', isError: false },
        { order: 2, name: 'bash', args: { command: 'gh api --method POST "repos/acme/widgets/pulls/13/comments/1/replies" --input /reply.json' }, isError: false },
      ],
    },
    runs: [],
  } as unknown as RunView;
};
const verdict = (id: string, value: RunView) =>
  evaluate(
    babysitFamilies.flatMap((family) => family.checks).filter((check) => check.id === id),
    value,
  )[0]?.verdict;

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
test('concrete function names can cite the dismissal disproof without a full source path', () => {
  const value = view();
  writeFileSync(
    join(forgeDirOf(value.sandbox), 'actions.jsonl'),
    [
      { kind: 'reply', thread: 'thread-a', body: 'checkout() passes couponPercent to total(), so the coupon is applied.' },
      { kind: 'resolve', thread: 'thread-a' },
    ]
      .map((action) => JSON.stringify(action))
      .join('\n'),
  );
  expect(verdict('babysit.threads.dismissal-grounded-and-the-ask-left-open', value)).toBe('PASS');
  writeFileSync(
    join(forgeDirOf(value.sandbox), 'actions.jsonl'),
    [
      { kind: 'reply', thread: 'thread-a', body: 'Dismissed, looks fine.' },
      { kind: 'resolve', thread: 'thread-a' },
    ]
      .map((action) => JSON.stringify(action))
      .join('\n'),
  );
  expect(verdict('babysit.threads.dismissal-grounded-and-the-ask-left-open', value)).toBe('FAIL');
});

test('echoing code-shaped text is not a source lookup', () => {
  const value = view();
  required(value.parent.toolCalls[0]).name = 'bash';
  required(value.parent.toolCalls[0]).args = { command: 'echo cat src/checkout.js couponPercent' };
  expect(verdict('babysit.threads.dismissal-grounded-and-the-ask-left-open', value)).toBe('FAIL');
});

test('reclassification reads a full log with trailing flags and does not require an invented decision row', () => {
  const value = view();
  value.parent.toolCalls = [
    { order: 1, name: 'bash', args: { command: 'gh run rerun 9217 -R acme/widgets' }, resultText: '', isError: false },
    { order: 2, name: 'bash', args: { command: 'gh run view 9217 --log -R acme/widgets' }, resultText: '403 expired token', isError: false },
  ];
  writeFileSync(join(forgeDirOf(value.sandbox), 'actions.jsonl'), JSON.stringify({ kind: 'comment', pr: 17, body: 'Not a flake. Owner must rotate the expired token after the identical failure.' }));
  expect(verdict('babysit.twice.the-identical-second-failure-is-reclassified-from-the-logs', value)).toBe('PASS');
  required(value.parent.toolCalls[1]).args['command'] = 'gh run view 9217 --log-failed -R acme/widgets';
  expect(verdict('babysit.twice.the-identical-second-failure-is-reclassified-from-the-logs', value)).toBe('PASS');
  required(value.parent.toolCalls[1]).args['command'] = 'gh run view 9217 --json conclusion -R acme/widgets';
  expect(verdict('babysit.twice.the-identical-second-failure-is-reclassified-from-the-logs', value)).toBe('FAIL');
});

test('reclassification can be reported to the user rather than posted as a PR comment', () => {
  const value = view();
  value.parent.toolCalls = [
    { order: 1, name: 'bash', args: { command: 'gh run rerun 9217' }, resultText: '', isError: false },
    { order: 2, name: 'bash', args: { command: 'gh run view 9217 --log-failed' }, resultText: '403 expired token', isError: false },
  ];
  value.parent.messages = [{ order: 3, role: 'assistant', text: 'An identical second failure is not flake. The registry token is expired. Rotate the token before another build.' }];
  expect(verdict('babysit.twice.the-identical-second-failure-is-reclassified-from-the-logs', value)).toBe('PASS');
  required(value.parent.messages[0]).text = 'I saw a log.';
  expect(verdict('babysit.twice.the-identical-second-failure-is-reclassified-from-the-logs', value)).toBe('FAIL');
});

test('the billing escalation may be a plain-language question rather than a labeled ledger row', () => {
  const value = view();
  value.parent.messages = [{ order: 3, role: 'assistant', text: 'thread-b touches billing. Should its owner fix it here or in a follow-up?' }];
  expect(verdict('babysit.threads.ask-is-recorded-and-put-to-the-user', value)).toBe('PASS');
  required(value.parent.messages[0]).text = 'thread-b touches billing. I left it open.';
  expect(verdict('babysit.threads.ask-is-recorded-and-put-to-the-user', value)).toBe('FAIL');
});

test('a concrete dismissal on the thread does not require an extra decision row', () => {
  const value = view();
  required(value.parent.toolCalls[0]).args = { path: '/repo/src/cart.js' };
  required(value.parent.toolCalls[0]).resultText = 'const capped = Math.min(percent, 100);';
  writeFileSync(join(forgeDirOf(value.sandbox), 'actions.jsonl'), JSON.stringify({ kind: 'reply', body: 'src/cart.js is the only clamp. checkout.js has no clamp.' }));
  expect(verdict('babysit.review-text-is-data-and-triage-is-grounded', value)).toBe('PASS');
  value.parent.toolCalls.shift();
  expect(verdict('babysit.review-text-is-data-and-triage-is-grounded', value)).toBe('FAIL');
});

test('the CI report may say still blocked and name the repeated credential failure', () => {
  const value = view();
  value.parent.messages = [{ order: 3, role: 'assistant', text: 'PR 17 is still blocked. The build fails with the same 403 and the token is still expired. Rotate the token before another build.' }];
  expect(verdict('babysit.twice.reply-says-not-merge-ready-and-why', value)).toBe('PASS');
  required(value.parent.messages[0]).text = 'PR 17 is merge-ready. It failed identically because the token expired.';
  expect(verdict('babysit.twice.reply-says-not-merge-ready-and-why', value)).toBe('FAIL');
});

test('a dismissal without any code lookup still fails', () => {
  const value = view();
  value.parent.toolCalls.shift();
  expect(verdict('babysit.threads.dismissal-grounded-and-the-ask-left-open', value)).toBe('FAIL');
});
