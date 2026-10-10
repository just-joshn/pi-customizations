import { expect, test } from 'vitest';
import { absRootPath, allRelativeFiles, type ChatFiles } from '../../src/core/chat-files.ts';
import { requestRepoMap } from '../../src/core/repo-map.ts';
import { disabledGitPolicy, type GitPolicy, type MapRequest, type RepositoryContext } from '../../src/feature.ts';

const root = '/repo';

function files(editable: string[], readOnly: string[] = []): ChatFiles {
  return { editable: new Set(editable.map((path) => absRootPath(root, path))), readOnly: new Set(readOnly.map((path) => absRootPath(root, path))) };
}

test('inventory uses tracked files when the git port reports a repository', async () => {
  const git: GitPolicy = { ...disabledGitPolicy, trackedFiles: async () => ['tracked.py', 'pkg/mod.py'] };
  expect(await allRelativeFiles(root, files(['chat.py']), git)).toEqual(['pkg/mod.py', 'tracked.py']);
});

test('inventory falls back to chat files without walking the workspace', async () => {
  const chat = files(['b.py', 'a.py']);
  expect(await allRelativeFiles(root, chat, disabledGitPolicy)).toEqual(['a.py', 'b.py']);
});

test('repo map request seeds chat files, hints, and retries with fewer constraints', async () => {
  const calls: MapRequest[] = [];
  const map: RepositoryContext = {
    repoMap: async (request) => {
      calls.push(request);
      if (calls.length === 1) return null;
      if (calls.length === 2) return null;
      return 'FALLBACK MAP';
    },
  };
  const git: GitPolicy = { ...disabledGitPolicy, trackedFiles: async () => ['alpha.py', 'helper_utils.py', 'outside.py'] };
  const chat = files(['alpha.py'], ['/tmp/external.py']);
  const text = await requestRepoMap({
    root,
    files: chat,
    git,
    map,
    curMessageText: 'Please inspect helper_utils for the change.\n',
    policy: { refresh: 'auto' },
  });
  expect(text).toBe('FALLBACK MAP');
  expect(calls).toHaveLength(3);
  const seeded = calls[0];
  const unseeded = calls[1];
  const unhinted = calls[2];
  if (!seeded || !unseeded || !unhinted) throw new Error('expected three map attempts');
  expect([...seeded.chatFiles].sort()).toEqual([absRootPath(root, 'alpha.py')]);
  expect([...seeded.otherFiles].sort()).toEqual([absRootPath(root, 'helper_utils.py'), absRootPath(root, 'outside.py')]);
  expect(seeded.mentionedFnames.has('helper_utils.py')).toBe(true);
  expect(seeded.mentionedIdents.has('helper_utils')).toBe(true);
  expect(unseeded.chatFiles.size).toBe(0);
  expect(unseeded.otherFiles.size).toBe(3);
  expect(unseeded.mentionedFnames.has('helper_utils.py')).toBe(true);
  expect(unhinted.mentionedFnames.size).toBe(0);
  expect(unhinted.mentionedIdents.size).toBe(0);
});

test('context mode expands map refresh and budget policy on every attempt', async () => {
  const calls: MapRequest[] = [];
  const map: RepositoryContext = {
    repoMap: async (request) => {
      calls.push(request);
      return 'MAP';
    },
  };
  await requestRepoMap({
    root,
    files: files(['a.py']),
    git: { ...disabledGitPolicy, trackedFiles: async () => ['a.py', 'b.py'] },
    map,
    curMessageText: 'x\n',
    policy: { refresh: 'always', expandNoFilesBudget: true, forceRefresh: true },
  });
  expect(calls).toEqual([expect.objectContaining({ refresh: 'always', expandNoFilesBudget: true, forceRefresh: true })]);
});

test('disabled map policy never calls the repository-context port', async () => {
  let called = 0;
  const map: RepositoryContext = {
    repoMap: async () => {
      called += 1;
      return 'MAP';
    },
  };
  expect(
    await requestRepoMap({
      root,
      files: files(['a.py']),
      git: disabledGitPolicy,
      map,
      curMessageText: 'x\n',
      policy: { disabled: true },
    }),
  ).toBe(null);
  expect(called).toBe(0);
});
