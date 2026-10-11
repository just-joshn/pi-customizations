import { join } from 'node:path';

import { expect, test } from 'vitest';
import { getRelFname } from '../../src/core/chat-files.ts';
import { getRankedTags, identifierMultiplier, isTagEntry, prependImportantFiles, type RankedEntry } from '../../src/map/rank.ts';
import { filterImportantFiles, isImportant } from '../../src/map/special.ts';
import { type Tag, tag } from '../../src/map/tag.ts';

const root = '/repo';

function def(rel: string, name: string, line = 0): Tag {
  return tag({ relFname: rel, fname: join(root, rel), name, kind: 'def', line });
}

function ref(rel: string, name: string, line = 1): Tag {
  return tag({ relFname: rel, fname: join(root, rel), name, kind: 'ref', line });
}

function rank(options: {
  readonly chat?: readonly string[];
  readonly other?: readonly string[];
  readonly mentionedFnames?: ReadonlySet<string>;
  readonly mentionedIdents?: ReadonlySet<string>;
  readonly tags: ReadonlyMap<string, readonly Tag[]>;
}): RankedEntry[] {
  const chat = (options.chat ?? []).map((rel) => join(root, rel));
  const other = (options.other ?? []).map((rel) => join(root, rel));
  return getRankedTags({
    chatFnames: chat,
    otherFnames: other,
    mentionedFnames: options.mentionedFnames ?? new Set(),
    mentionedIdents: options.mentionedIdents ?? new Set(),
    tagsByAbsPath: options.tags,
    getRelFname: (abs) => getRelFname(root, abs),
    fileExists: () => true,
  });
}

test('weighted PageRank over same-name def/ref edges omits chat definitions from ranked tags', {
  meta: {
    aider: ['test_repomap/TestRepoMap.test_repo_map'],
  },
}, () => {
  const tags = new Map<string, Tag[]>([
    [join(root, 'chat.py'), [def('chat.py', 'Helper'), ref('chat.py', 'Util')]],
    [join(root, 'other.py'), [def('other.py', 'Util'), ref('other.py', 'Helper'), ref('other.py', 'Helper')]],
    [join(root, 'lib.py'), [def('lib.py', 'Helper')]],
  ]);
  const ranked = rank({
    chat: ['chat.py'],
    other: ['other.py', 'lib.py'],
    mentionedIdents: new Set(['Helper']),
    tags,
  });
  const defNames = ranked.filter(isTagEntry).map((entry) => `${entry.relFname}:${entry.name}`);
  expect(defNames.some((name) => name.startsWith('chat.py:'))).toBe(false);
  expect(defNames).toContain('lib.py:Helper');
  expect(defNames).toContain('other.py:Util');
  expect(ranked.map((entry) => entry.relFname)).toEqual(expect.arrayContaining(['lib.py', 'other.py']));
});

test('identifier weights multiply mentions and long names by ten, chat refs by fifty, commons by one tenth', {
  meta: {
    aider: ['test_repomap/TestRepoMap.test_repo_map'],
  },
}, () => {
  expect(identifierMultiplier('Helper', new Set(['Helper']), 1)).toBe(10);
  expect(identifierMultiplier('long_name', new Set(), 1)).toBe(10);
  expect(identifierMultiplier('_priv', new Set(), 1)).toBe(0.1);
  expect(identifierMultiplier('_private', new Set(), 1)).toBe(1);
  expect(identifierMultiplier('Foo', new Set(), 6)).toBe(0.1);
  expect(identifierMultiplier('Foo', new Set(['Foo']), 1)).toBe(10);

  const tags = new Map<string, Tag[]>([
    [join(root, 'a.py'), [def('a.py', 'Noise'), ref('a.py', 'Target'), ref('a.py', 'Target')]],
    [join(root, 'b.py'), [def('b.py', 'Target'), ref('b.py', 'Noise')]],
    [join(root, 'c.py'), [def('c.py', 'Noise'), ref('c.py', 'Target')]],
  ]);
  const mentioned = rank({
    chat: ['a.py'],
    other: ['b.py', 'c.py'],
    mentionedIdents: new Set(['Target']),
    tags,
  });
  const plain = rank({
    chat: ['a.py'],
    other: ['b.py', 'c.py'],
    tags,
  });
  expect(mentioned.find(isTagEntry)?.name).toBe('Target');
  expect(plain.find(isTagEntry)?.name).toBeDefined();
  expect(mentioned.find(isTagEntry)?.relFname).toBe('b.py');
});

test('personalization boosts chat and path/ident matches by 100 over the scan universe and stores only positives', {
  meta: {
    aider: ['test_repomap/TestRepoMap.test_repo_map'],
  },
}, () => {
  const tags = new Map<string, Tag[]>([
    [join(root, 'pkg/helper_utils.py'), [def('pkg/helper_utils.py', 'run')]],
    [join(root, 'other.py'), [ref('other.py', 'run')]],
    [join(root, 'chat.py'), [ref('chat.py', 'run')]],
  ]);
  const ranked = rank({
    chat: ['chat.py'],
    other: ['pkg/helper_utils.py', 'other.py'],
    mentionedIdents: new Set(['helper_utils']),
    tags,
  });
  const firstDef = ranked.find(isTagEntry);
  expect(firstDef?.relFname).toBe('pkg/helper_utils.py');
});

test('definition scores order non-chat defs then append filename-only leftovers before budget search', {
  meta: {
    aider: ['test_repomap/TestRepoMap.test_repo_map'],
  },
}, () => {
  const tags = new Map<string, Tag[]>([
    [join(root, 'a.py'), [def('a.py', 'A'), ref('a.py', 'B')]],
    [join(root, 'b.py'), [def('b.py', 'B'), ref('b.py', 'A')]],
    [join(root, 'empty.py'), []],
  ]);
  const ranked = rank({
    chat: ['a.py'],
    other: ['b.py', 'empty.py'],
    tags,
  });
  expect(ranked.filter(isTagEntry).every((entry) => entry.relFname !== 'a.py')).toBe(true);
  expect(ranked.some((entry) => !isTagEntry(entry) && entry.relFname === 'empty.py')).toBe(true);
  expect(ranked.some((entry) => (!isTagEntry(entry) && entry.relFname === 'b.py') || (isTagEntry(entry) && entry.relFname === 'b.py'))).toBe(true);
});

test('important basenames match configured root names case-sensitively and prepend when absent from ranked list', {
  meta: {
    aider: ['test_special/test_is_important', 'test_special/test_filter_important_files', 'test_special/test_is_important_case_sensitivity', 'test_special/test_is_important_with_paths', 'test_special/test_is_important_various_files'],
  },
}, () => {
  expect(isImportant('README.md')).toBe(true);
  expect(isImportant('readme.md')).toBe(false);
  expect(isImportant('.gitignore')).toBe(true);
  expect(isImportant('.GITIGNORE')).toBe(false);
  expect(isImportant('project/README.md')).toBe(false);
  expect(isImportant('./README.md')).toBe(true);
  expect(isImportant('/absolute/path/to/README.md')).toBe(false);
  expect(isImportant(join('.github', 'workflows', 'test.yml'))).toBe(true);
  expect(isImportant('Dockerfile')).toBe(true);
  expect(isImportant('random_file.txt')).toBe(false);

  const important = filterImportantFiles(['README.md', 'src/main.py', '.gitignore', 'tests/test_app.py', 'requirements.txt', '.github/workflows/test.yml', 'random_file.txt']);
  expect(new Set(important)).toEqual(new Set(['README.md', '.gitignore', 'requirements.txt', '.github/workflows/test.yml']));

  const prepended = prependImportantFiles([], ['src/main.py', 'README.md', 'pkg/mod.py']);
  expect(prepended.map((entry) => entry.relFname)).toEqual(['README.md']);
  expect(prependImportantFiles([{ relFname: 'README.md' }], ['README.md', 'LICENSE']).map((entry) => entry.relFname)).toEqual(['LICENSE', 'README.md']);
});
