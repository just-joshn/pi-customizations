import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { absRootPath, allRelativeFiles, type ChatFiles } from '../../src/core/chat-files.ts';
import { getCurMessageText, type ContextMessage } from '../../src/core/context.ts';
import { getFileMentions } from '../../src/core/mentions.ts';
import { getIdentFilenameMatches, getIdentMentions, requestRepoMap, type RepoMapEnv } from '../../src/core/repo-map.ts';
import { disabledGitPolicy, type MapRequest } from '../../src/feature.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from '../git/support.ts';

test(
  'map file universe is sorted deduplicated Git HEAD-and-index inventory after aiderignore; untracked excluded',
  {
    meta: {
      aider: ['test_repo/TestRepo.test_get_tracked_files_with_aiderignore', 'test_repo/TestRepo.test_get_tracked_files_from_subdir'],
      evidence: ['ev-git/probe/subtree-filtering'],
    },
  },
  async () => {
    const root = await tempDir('map-files-universe-');
    const host = recordingHost();
    await initRepo(root);
    await commitFile(root, 'keep.py', 'k\n', 'keep');
    await mkdir(join(root, 'pkg'), { recursive: true });
    await writeFile(join(root, 'pkg/mod.py'), 'm\n');
    await writeFile(join(root, 'skip.py'), 's\n');
    await writeFile(join(root, 'untracked.py'), 'u\n');
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const { isolatedExec } = await import('../../src/core/isolated-exec.ts');
    await isolatedExec({ command: 'git', args: ['add', '--', 'pkg/mod.py', 'skip.py'], cwd: root }, env);
    await writeFile(join(root, '.aiderignore'), 'skip.py\n');

    const git = policyIn(root, host);
    const files: ChatFiles = { editable: new Set(), readOnly: new Set() };
    const universe = await allRelativeFiles(root, files, git);
    expect(universe).toEqual(['keep.py', 'pkg/mod.py']);
    expect(universe).not.toContain('untracked.py');
    expect(universe).not.toContain('skip.py');

    await writeFile(join(root, 'keep.py'), 'changed working tree\n');
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(root, 'keep.py'), 'utf8')).toBe('changed working tree\n');
  },
);

test(
  'normal mapping partitions editable plus in-root read-only as chat files and excludes them from rendered map text',
  {
    meta: {
      aider: ['test_coder/TestCoder.test_get_repo_map'],
    },
  },
  async () => {
    const root = await tempDir('map-files-partition-');
    const chatAbs = absRootPath(root, 'chat.py');
    const readAbs = absRootPath(root, 'notes.md');
    const otherAbs = absRootPath(root, 'other.py');
    const outsideRead = absRootPath(root, '../outside.py');
    let seen: MapRequest | null = null;
    const env: RepoMapEnv = {
      root,
      files: {
        editable: new Set([chatAbs]),
        readOnly: new Set([readAbs, outsideRead]),
      },
      git: {
        ...disabledGitPolicy,
        trackedFiles: async () => ['chat.py', 'notes.md', 'other.py'],
      },
      map: {
        repoMap: async (request) => {
          seen = request;
          return 'MAP\n';
        },
      },
      curMessageText: 'look at other.py\n',
      policy: {},
    };
    expect(await requestRepoMap(env)).toBe('MAP\n');
    expect(seen).not.toBeNull();
    expect(seen?.chatFiles.has(chatAbs)).toBe(true);
    expect(seen?.chatFiles.has(readAbs)).toBe(true);
    expect(seen?.chatFiles.has(outsideRead)).toBe(false);
    expect(seen?.otherFiles.has(otherAbs)).toBe(true);
    expect(seen?.otherFiles.has(chatAbs)).toBe(false);
  },
);

test(
  'mention hints come from current messages only via path, unique punctuated basename, and stem matches of length >= 5',
  {
    meta: {
      aider: [
        'test_coder/TestCoder.test_get_file_mentions_various_formats',
        'test_coder/TestCoder.test_get_file_mentions_path_formats',
      ],
    },
  },
  () => {
    expect([...getIdentMentions('Please inspect helper_utils and Foo.Bar!')].sort()).toEqual([
      'Bar',
      'Foo',
      'Please',
      'and',
      'helper_utils',
      'inspect',
    ]);

    const addable = ['pkg/helper_utils.py', 'pkg/other.py', 'unique_file.py', 'dup/a.py', 'dup/b.py'];
    expect(
      [...getFileMentions({ content: 'see unique_file.py and pkg/helper_utils.py', addable, inchat: [], readOnly: [], ignoreCurrent: false })].sort(),
    ).toEqual(['pkg/helper_utils.py', 'unique_file.py']);

    expect([...getIdentFilenameMatches(new Set(['helper_utils', 'short', 'other']), addable)].sort()).toEqual([
      'pkg/helper_utils.py',
      'pkg/other.py',
    ]);
    expect([...getIdentFilenameMatches(new Set(['a']), ['dup/a.py', 'dup/b.py'])]).toEqual([]);

    const completed: ContextMessage[] = [{ role: 'user', content: 'old history mentions gone.py\n', timestamp: 0 }];
    const current: ContextMessage[] = [{ role: 'user', content: 'please open unique_file.py now\n', timestamp: 1 }];
    const text = getCurMessageText(current);
    expect(text).toContain('unique_file.py');
    expect(text).not.toContain('gone.py');
    expect(getCurMessageText([...completed, ...current])).toContain('gone.py');

    const mentioned = new Set([
      ...getFileMentions({ content: text, addable, inchat: [], readOnly: [], ignoreCurrent: false }),
      ...getIdentFilenameMatches(getIdentMentions(text), addable),
    ]);
    expect(mentioned.has('unique_file.py')).toBe(true);
    expect(mentioned.has('gone.py')).toBe(false);
  },
);
