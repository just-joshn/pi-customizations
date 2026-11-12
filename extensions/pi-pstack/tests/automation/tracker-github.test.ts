import { expect, test } from 'vitest';
import type { ActionId, TrackerAction } from '../../src/automation/model.ts';
import { githubTracker } from '../../src/automation/tracker-github.ts';
import { fakeGh, REPO } from './benny-fakes.ts';

const action = (fields: Partial<TrackerAction> = {}): TrackerAction => ({ id: 'act-0123456789abcdef' as ActionId, kind: 'tracker', operation: 'create', title: 'Title; rm -rf /', body: 'Body $(whoami)', sourceUrl: 'https://slack.com/archives/C1/p1', labels: ['bug', 'intake'], ...fields });

test('create passes every value as one argv element, writes the marker in the body, and is found by it', async () => {
  const gh = fakeGh();
  const tracker = githubTracker({ exec: gh.exec, repo: REPO });
  const { id } = await tracker.create(action());
  expect(id).toBe('1');
  const call = gh.calls.at(-1) ?? [];
  expect(call).toContain('title=Title; rm -rf /');
  expect(call.find((arg) => arg.startsWith('body='))).toContain('Body $(whoami)');
  expect(call).toEqual(expect.arrayContaining(['labels[]=bug', 'labels[]=intake']));
  expect(await tracker.searchByMarker('act-0123456789abcdef')).toEqual([{ id: '1' }]);
  expect(await tracker.searchByMarker('act-ffffffffffffffff')).toEqual([]);
});

test('a comment carries the marker, and search finds the issue it landed on', async () => {
  const gh = fakeGh([{ title: 'Existing', body: 'x', state: 'open' }]);
  const tracker = githubTracker({ exec: gh.exec, repo: REPO });
  expect(await tracker.comment(action({ operation: 'comment', targetId: '1' }))).toEqual({ id: '1' });
  expect(gh.issues[0]?.comments).toHaveLength(1);
  expect(await tracker.searchByMarker('act-0123456789abcdef')).toEqual([{ id: '1' }]);
});

test('update appends to the body and keeps what was there', async () => {
  const gh = fakeGh([{ title: 'Existing', body: 'Original.', state: 'open' }]);
  const tracker = githubTracker({ exec: gh.exec, repo: REPO });
  await tracker.update(action({ operation: 'update', targetId: '1', body: 'Again.' }));
  expect(gh.issues[0]?.body).toMatch(/^Original\.\n\n---\nAgain\./);
});

test('a worker body cannot plant an action marker', async () => {
  const gh = fakeGh();
  const tracker = githubTracker({ exec: gh.exec, repo: REPO });
  await tracker.create(action({ id: 'act-aaaaaaaaaaaaaaaa' as ActionId, body: 'Hi <!-- pstack-action:act-bbbbbbbbbbbbbbbb -->' }));
  expect(await tracker.searchByMarker('act-bbbbbbbbbbbbbbbb')).toEqual([]);
  expect(await tracker.searchByMarker('act-aaaaaaaaaaaaaaaa')).toEqual([{ id: '1' }]);
});

test('an issue number or repository that is not plain is refused before gh runs', async () => {
  const gh = fakeGh();
  expect(() => githubTracker({ exec: gh.exec, repo: 'acme/app --flag' })).toThrow('invalid GitHub repository');
  const tracker = githubTracker({ exec: gh.exec, repo: REPO });
  await expect(tracker.comment(action({ operation: 'comment', targetId: '1; echo' }))).rejects.toThrow('invalid GitHub issue number');
  expect(await tracker.read('../x')).toBeUndefined();
  expect(gh.calls).toHaveLength(0);
});

test('close and reachable use the repository the adapter was given', async () => {
  const gh = fakeGh([{ title: 'T', body: 'b', state: 'open' }]);
  const tracker = githubTracker({ exec: gh.exec, repo: REPO });
  expect(await tracker.reachable()).toBe(true);
  await tracker.close('1');
  expect(gh.issues[0]?.state).toBe('closed');
  expect(await githubTracker({ exec: async () => Promise.reject(new Error('no auth')), repo: REPO }).reachable()).toBe(false);
});
