import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Snapshot } from '../../src/core/branch.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledRepositoryContext, disabledValidation, type EditCandidate, type EditContext, type EditIntent } from '../../src/feature.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

type Upsert = readonly [string | null, EditIntent | null];

function snapshot(root: string): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'whole',
    phase: { kind: 'main' },
    files: { editable: [], readOnly: [] },
    originalReadOnly: [],
    returnMode: null,
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: null,
    historyThrough: null,
    physicalModel: null,
    editorModel: null,
    weakModel: null,
    lifecycle: { kind: 'idle' },
  };
}

test(
  'gitignored paths are skipped with the Aider skip warning',
  { meta: { aider: ['test_coder/TestCoder.test_skip_gitignored_files_on_init'] } },
  async () => {
    const root = await tempDir('git-auth-ignore-');
    const host = recordingHost();
    await initRepo(root);
    await commitFile(root, 'tracked.py', 't\n');
    await writeFile(join(root, '.gitignore'), 'secret.env\n');
    await writeFile(join(root, 'secret.env'), 'x=1\n');
    const git = policyIn(root, host);
    expect(await git.isGitIgnored('secret.env')).toBe(true);

    const tree = createWorkingTree({ notices: host });
    const controller = new ExchangeController(snapshot(root), {
      ports: {
        edit: {
          formats: new Map(),
          requestedFormat: null,
          initialFiles: { editable: [], readOnly: [] },
          messageFile: null,
          dryRun: false,
          yesAlways: true,
          autoAcceptArchitect: true,
          editorModel: null,
          chatLanguage: null,
          editorEditFormat: 'editor-whole',
          tree,
        },
        git,
        map: disabledRepositoryContext,
        lint: disabledValidation,
      },
      host,
      source: { get: async () => { throw new Error('unused'); } },
      append: () => {},
      suggestShellCommands: false,
    });
    const context: EditContext = {
      fence: ['```', '```'],
      root,
      inchatRelativeFiles: [],
      absRootPath: (path) => absRootPath(root, path),
      tree,
      notices: host,
    };
    const candidate = (path: string): EditCandidate<Upsert> => ({
      edit: [path, { kind: 'update', path }],
      intent: { kind: 'update', path },
    });
    const prepared = await controller.prepareToEdit([candidate('secret.env'), candidate('tracked.py')], context);
    expect(host.warnings).toContain('Skipping edits to secret.env that matches gitignore spec.');
    expect(prepared.map((entry) => entry.edit[0])).toEqual(['tracked.py']);
  },
);

test(
  'an untracked approved path is staged when automatic commits are on',
  { meta: { aider: ['test_coder/TestCoder.test_new_file_edit_one_commit'] } },
  async () => {
    const root = await tempDir('git-auth-stage-');
    const host = recordingHost();
    await initRepo(root);
    await commitFile(root, 'seed.txt', 's\n');
    await mkdir(join(root, 'nested'), { recursive: true });
    const git = policyIn(root, host);
    expect(await git.needToAdd('nested/new.txt')).toBe(true);
    const abs = join(root, 'nested/new.txt');
    await writeFile(abs, '');
    await git.stageNewFile(abs);
    const tracked = await git.trackedFiles();
    expect(tracked).toContain('nested/new.txt');
  },
);

test('stageNewFile is a no-op when automatic commits are off', async () => {
  const root = await tempDir('git-auth-nostage-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'seed.txt', 's\n');
  const git = policyIn(root, host, { autoCommits: false });
  const abs = join(root, 'fresh.txt');
  await writeFile(abs, 'x\n');
  await git.stageNewFile(abs);
  expect(await git.trackedFiles()).not.toContain('fresh.txt');
});
