import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { getFileMentions } from '../../src/core/mentions.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, type GitPolicy } from '../../src/feature.ts';

const unusedPrompts = {
  get: async () => {
    throw new Error('prompts unused in mentions-bind tests');
  },
};

function mentioned(content: string, addable: readonly string[], options: { readonly inchat?: readonly string[]; readonly readOnly?: readonly string[]; readonly ignoreCurrent?: boolean } = {}): string[] {
  return [...getFileMentions({ content, addable, inchat: options.inchat ?? [], readOnly: options.readOnly ?? [], ignoreCurrent: options.ignoreCurrent ?? false })].sort();
}

function snapshot(root: string, files: { editable?: string[]; readOnly?: string[]; ignoredMentions?: string[] } = {}): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'whole',
    phase: { kind: 'main' },
    files: { editable: files.editable ?? [], readOnly: files.readOnly ?? [] },
    originalReadOnly: [],
    returnMode: null,
    ignoredMentions: files.ignoredMentions ?? [],
    neverAsk: [],
    lastUserEntry: null,
    historyThrough: null,
    physicalModel: null,
    editorModel: null,
    weakModel: null,
    assistantCommits: [],
    lifecycle: { kind: 'idle' },
  };
}

async function harness(options: {
  readonly files?: { editable?: string[]; readOnly?: string[]; ignoredMentions?: string[] };
  readonly tracked?: readonly string[];
  readonly confirm?: (request: { question: string; subject?: string | null }) => Promise<boolean>;
}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'mentions-bind-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const confirms: { question: string; subject?: string | null }[] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async (request) => {
      confirms.push({ question: request.question, subject: request.subject ?? null });
      return options.confirm?.(request) ?? true;
    },
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const git: GitPolicy = {
    ...disabledGitPolicy,
    trackedFiles: async () => [...(options.tracked ?? [])],
  };
  const controller = new ExchangeController(snapshot(root, options.files), {
    ports: {
      edit: {
        formats: new Map(),
        requestedFormat: null,
        initialFiles: { editable: [], readOnly: [] },
        dryRun: false,
        yesAlways: null,
        autoAcceptArchitect: true,
        editorModel: null,
        chatLanguage: null,
        editorEditFormat: 'editor-whole',
        messageFile: null,
        applyFile: null,
        tree: createWorkingTree({ notices: host }),
      },
      git,
      map: disabledRepositoryContext,
      lint: disabledValidation,
    },
    host,
    source: unusedPrompts,
    append: () => {},
    suggestShellCommands: false,
  });
  return { root, controller, confirms };
}

test('getFileMentions extracts plain, backtick, fence, quote, bold, and Windows-slash paths', {
  meta: {
    aider: ['test_coder/TestCoder.test_get_file_mentions_various_formats', 'test_coder/TestCoder.test_get_file_mentions_path_formats'],
  },
}, () => {
  const addable = ['file1.txt', 'file2.py', 'dir/nested_file.js', 'dir/subdir/deep_file.html', 'file99.txt', 'special_chars!@#.md'];
  expect(mentioned('You should edit file1.txt first', addable)).toEqual(['file1.txt']);
  expect(mentioned('Edit both file1.txt and file2.py', addable)).toEqual(['file1.txt', 'file2.py']);
  expect(mentioned('Check the file `dir/nested_file.js`', addable)).toEqual(['dir/nested_file.js']);
  expect(mentioned('```\ndir/subdir/deep_file.html\n```', addable)).toEqual(['dir/subdir/deep_file.html']);
  expect(mentioned('Edit the file dir\\nested_file.js', addable)).toEqual(['dir/nested_file.js']);
  expect(mentioned('Check "special_chars!@#.md" now', addable)).toEqual(['special_chars!@#.md']);
  expect(mentioned('You should check **file1.txt** for issues', addable)).toEqual(['file1.txt']);
  expect(mentioned('Look at both **file2.py** and **dir/nested_file.js**', addable)).toEqual(['dir/nested_file.js', 'file2.py']);
  expect(mentioned('The file **dir\\subdir\\deep_file.html** needs updating', addable)).toEqual(['dir/subdir/deep_file.html']);
  expect(mentioned("First, edit `file1.txt`. Then modify file2.py.\n```js\n// Update this file\nconst file = 'dir/nested_file.js';\n```\nFinally check dir\\subdir\\deep_file.html", addable)).toEqual([
    'dir/nested_file.js',
    'dir/subdir/deep_file.html',
    'file1.txt',
    'file2.py',
  ]);

  expect(mentioned('Check file1.txt and dir/file2.txt', ['file1.txt', 'dir/file2.txt'])).toEqual(['dir/file2.txt', 'file1.txt']);
  expect(mentioned('Check file1.txt and dir\\file2.txt', ['file1.txt', 'dir\\file2.txt'])).toEqual(['dir\\file2.txt', 'file1.txt']);
  expect(mentioned('Check file1.txt and dir/file2.txt', ['file1.txt', 'dir\\file2.txt'])).toEqual(['dir\\file2.txt', 'file1.txt']);
  expect(mentioned('Check file1.txt and dir\\file2.txt', ['file1.txt', 'dir/file2.txt'])).toEqual(['dir/file2.txt', 'file1.txt']);
});

test('getFileMentions keeps multiline backtick paths', {
  meta: {
    aider: ['test_coder/TestCoder.test_get_file_mentions_multiline_backticks'],
  },
}, () => {
  const addable = ['swebench/harness/test_spec/python.py', 'swebench/harness/test_spec/javascript.py'];
  const content = `
Could you please **add the following files to the chat**?

1.  \`swebench/harness/test_spec/python.py\`
2.  \`swebench/harness/test_spec/javascript.py\`

Once I have these, I can show you precisely how to do the thing.
`;
  expect(mentioned(content, addable)).toEqual([...addable].sort());
});

test('getFileMentions skips ambiguous basenames and basenames already in chat', {
  meta: {
    aider: ['test_coder/TestCoder.test_skip_duplicate_basename_mentions', 'test_coder/TestCoder.test_check_for_file_mentions_read_only'],
  },
}, () => {
  expect(mentioned('Check file.txt and unique.txt', ['dir1/file.txt', 'dir2/file.txt', 'dir3/unique.txt'], { inchat: ['dir1/file.txt'] })).toEqual(['dir3/unique.txt']);
  expect(
    mentioned('Check dir1/file.txt and unique.txt', ['dir2/file.txt', 'dir3/unique.txt'], {
      inchat: ['dir1/file.txt'],
      readOnly: ['dir2/file.txt'],
    }),
  ).toEqual(['dir3/unique.txt']);
  expect(mentioned('Please check readonly_file.txt!', [], { readOnly: ['readonly_file.txt'] })).toEqual([]);
});

test('checkForFileMentions prefers the exact shorter path when basenames collide', {
  meta: {
    aider: ['test_coder/TestCoder.test_check_for_ambiguous_filename_mentions_of_longer_paths'],
  },
}, async () => {
  const h = await harness({ tracked: ['file1.txt', 'other/file1.txt'] });
  const notice = await h.controller.checkForFileMentions('Please check file1.txt!');
  expect(notice).toBe('I added these files to the chat: file1.txt\nLet me know if there are others we should add.');
  expect(h.controller.snapshot.files.editable).toEqual([absRootPath(h.root, 'file1.txt')]);
  expect(h.confirms).toEqual([{ question: 'Add file to the chat?', subject: 'file1.txt' }]);
});

test('checkForFileMentions admits a nested backtick path', {
  meta: {
    aider: ['test_coder/TestCoder.test_check_for_subdir_mention'],
  },
}, async () => {
  const h = await harness({ tracked: ['other/file1.txt'] });
  expect(await h.controller.checkForFileMentions('Please check `other/file1.txt`')).toBe('I added these files to the chat: other/file1.txt\nLet me know if there are others we should add.');
  expect(h.controller.snapshot.files.editable).toEqual([absRootPath(h.root, 'other/file1.txt')]);
});

test('checkForFileMentions skips read-only inventory without prompting', {
  meta: {
    aider: ['test_coder/TestCoder.test_check_for_file_mentions_read_only'],
  },
}, async () => {
  const h = await harness({ tracked: ['readonly_file.txt'] });
  h.controller.save({
    ...h.controller.snapshot,
    files: { editable: [], readOnly: [absRootPath(h.root, 'readonly_file.txt')] },
  });
  expect(await h.controller.checkForFileMentions('Please check readonly_file.txt!')).toBeNull();
  expect(h.controller.snapshot.files.editable).toEqual([]);
  expect(h.confirms).toEqual([]);
});

test('checkForFileMentions offers paths in sorted order, admits approvals, and remembers declines', {
  meta: {
    aider: ['test_coder/TestCoder.test_check_for_file_mentions_with_mocked_confirm'],
  },
}, async () => {
  const answers = new Map<string, boolean>([
    ['file1.txt', false],
    ['file2.txt', true],
  ]);
  const h = await harness({
    tracked: ['file1.txt', 'file2.txt'],
    confirm: async (request) => answers.get(request.subject ?? '') ?? false,
  });
  const first = await h.controller.checkForFileMentions('Please check file1.txt and file2.txt');
  expect(h.confirms.map((entry) => entry.subject)).toEqual(['file1.txt', 'file2.txt']);
  expect(first).toBe('I added these files to the chat: file2.txt\nLet me know if there are others we should add.');
  expect(h.controller.snapshot.files.editable).toEqual([absRootPath(h.root, 'file2.txt')]);
  expect(h.controller.snapshot.ignoredMentions).toEqual(['file1.txt']);

  const confirmsAfter = h.confirms.length;
  expect(await h.controller.checkForFileMentions('Please check file1.txt and file2.txt again')).toBeNull();
  expect(h.confirms.slice(confirmsAfter)).toEqual([]);
  expect(h.controller.snapshot.files.editable).toEqual([absRootPath(h.root, 'file2.txt')]);
  expect(h.controller.snapshot.ignoredMentions).toEqual(['file1.txt']);
});
