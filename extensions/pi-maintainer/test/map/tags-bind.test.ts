import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { extractTags } from '../../src/map/extract.ts';
import { packagedQueryAssetRoots, type QueryAssetRoots, readTagsQuery, selectTagsQueryPath } from '../../src/map/query-assets.ts';
import type { CaptureOutcome, Captures, QueryRuntime } from '../../src/map/query-runtime.ts';
import { unavailableQueryRuntime } from '../../src/map/query-runtime.ts';
import { lexicalReferenceTags, type Tag } from '../../src/map/tag.ts';

const TAGS_META = {
  aider: [
    'test_repomap/TestRepoMap.test_get_repo_map',
    'test_repomap/TestRepoMapAllLanguages.test_language_arduino',
    'test_repomap/TestRepoMapAllLanguages.test_language_bash',
    'test_repomap/TestRepoMapAllLanguages.test_language_c',
    'test_repomap/TestRepoMapAllLanguages.test_language_chatito',
    'test_repomap/TestRepoMapAllLanguages.test_language_clojure',
    'test_repomap/TestRepoMapAllLanguages.test_language_commonlisp',
    'test_repomap/TestRepoMapAllLanguages.test_language_cpp',
    'test_repomap/TestRepoMapAllLanguages.test_language_csharp',
    'test_repomap/TestRepoMapAllLanguages.test_language_d',
    'test_repomap/TestRepoMapAllLanguages.test_language_dart',
    'test_repomap/TestRepoMapAllLanguages.test_language_elisp',
    'test_repomap/TestRepoMapAllLanguages.test_language_elixir',
    'test_repomap/TestRepoMapAllLanguages.test_language_elm',
    'test_repomap/TestRepoMapAllLanguages.test_language_gleam',
    'test_repomap/TestRepoMapAllLanguages.test_language_go',
    'test_repomap/TestRepoMapAllLanguages.test_language_haskell',
    'test_repomap/TestRepoMapAllLanguages.test_language_hcl',
    'test_repomap/TestRepoMapAllLanguages.test_language_java',
    'test_repomap/TestRepoMapAllLanguages.test_language_javascript',
    'test_repomap/TestRepoMapAllLanguages.test_language_kotlin',
    'test_repomap/TestRepoMapAllLanguages.test_language_lua',
    'test_repomap/TestRepoMapAllLanguages.test_language_matlab',
    'test_repomap/TestRepoMapAllLanguages.test_language_ocaml',
    'test_repomap/TestRepoMapAllLanguages.test_language_ocaml_interface',
    'test_repomap/TestRepoMapAllLanguages.test_language_php',
    'test_repomap/TestRepoMapAllLanguages.test_language_pony',
    'test_repomap/TestRepoMapAllLanguages.test_language_properties',
    'test_repomap/TestRepoMapAllLanguages.test_language_python',
    'test_repomap/TestRepoMapAllLanguages.test_language_r',
    'test_repomap/TestRepoMapAllLanguages.test_language_racket',
    'test_repomap/TestRepoMapAllLanguages.test_language_ruby',
    'test_repomap/TestRepoMapAllLanguages.test_language_rust',
    'test_repomap/TestRepoMapAllLanguages.test_language_scala',
    'test_repomap/TestRepoMapAllLanguages.test_language_solidity',
    'test_repomap/TestRepoMapAllLanguages.test_language_swift',
    'test_repomap/TestRepoMapAllLanguages.test_language_tsx',
    'test_repomap/TestRepoMapAllLanguages.test_language_typescript',
    'test_repomap/TestRepoMapAllLanguages.test_language_udev',
    'test_repomap/TestRepoMapAllLanguages.test_language_zig',
    'test_repomap/TestRepoMapAllLanguages.test_repo_map_sample_code_base',
  ],
  evidence: [
    'ev-map/julia/get-repo-map',
    'ev-map/probe/provider-tags',
    'ev-map/query/arduino',
    'ev-map/query/bash',
    'ev-map/query/c',
    'ev-map/query/chatito',
    'ev-map/query/clojure',
    'ev-map/query/commonlisp',
    'ev-map/query/cpp',
    'ev-map/query/csharp',
    'ev-map/query/d',
    'ev-map/query/dart',
    'ev-map/query/elisp',
    'ev-map/query/elixir',
    'ev-map/query/elm',
    'ev-map/query/fortran',
    'ev-map/query/gleam',
    'ev-map/query/go',
    'ev-map/query/haskell',
    'ev-map/query/hcl',
    'ev-map/query/java',
    'ev-map/query/javascript',
    'ev-map/query/julia',
    'ev-map/query/kotlin',
    'ev-map/query/lua',
    'ev-map/query/matlab',
    'ev-map/query/ocaml',
    'ev-map/query/ocaml-interface',
    'ev-map/query/php',
    'ev-map/query/pony',
    'ev-map/query/properties',
    'ev-map/query/python',
    'ev-map/query/r',
    'ev-map/query/racket',
    'ev-map/query/ruby',
    'ev-map/query/rust',
    'ev-map/query/scala',
    'ev-map/query/solidity',
    'ev-map/query/swift',
    'ev-map/query/typescript',
    'ev-map/query/udev',
    'ev-map/query/zig',
  ],
};

function runtimeWith(opts: { readonly lang?: string | null; readonly outcome?: CaptureOutcome | ((queryScm: string) => CaptureOutcome) }): QueryRuntime {
  return {
    languageFor: () => (opts.lang === undefined ? 'python' : opts.lang),
    capture: ({ queryScm }) => {
      const outcome = opts.outcome ?? { kind: 'unavailable' as const };
      return typeof outcome === 'function' ? outcome(queryScm) : outcome;
    },
  };
}

function ok(captures: Captures): CaptureOutcome {
  return { kind: 'ok', captures };
}

test('repository tags carry relative and absolute paths, kind, name, and zero-based or minus-one lines', {
  meta: TAGS_META,
}, () => {
  const tags = extractTags({
    relFname: 'pkg/mod.py',
    fname: '/repo/pkg/mod.py',
    code: 'class Helper:\n    pass\n',
    runtime: runtimeWith({
      outcome: ok({
        'name.definition.class': [{ text: 'Helper', startLine: 0 }],
        'name.reference.call': [{ text: 'Helper', startLine: 1 }],
      }),
    }),
    resolveQuery: () => '(class_definition)',
  });
  expect(tags).toEqual([
    { relFname: 'pkg/mod.py', fname: '/repo/pkg/mod.py', name: 'Helper', kind: 'def', line: 0 },
    { relFname: 'pkg/mod.py', fname: '/repo/pkg/mod.py', name: 'Helper', kind: 'ref', line: 1 },
  ]);
  const lexical = lexicalReferenceTags({
    relFname: 'pkg/mod.py',
    fname: '/repo/pkg/mod.py',
    code: 'x',
    names: ['Helper'],
  });
  expect(lexical).toEqual([{ relFname: 'pkg/mod.py', fname: '/repo/pkg/mod.py', name: 'Helper', kind: 'ref', line: -1 }]);
});

test('unsupported language, unavailable parser or query, and empty input yield no semantic tags', {
  meta: TAGS_META,
}, () => {
  const base = {
    relFname: 'a.py',
    fname: '/repo/a.py',
    code: 'def f():\n    return 1\n',
    resolveQuery: () => '(function_definition)',
  };
  expect(extractTags({ ...base, runtime: runtimeWith({ lang: null }) })).toEqual([]);
  expect(
    extractTags({
      ...base,
      runtime: runtimeWith({ outcome: { kind: 'unavailable' } }),
    }),
  ).toEqual([]);
  expect(
    extractTags({
      ...base,
      runtime: runtimeWith({ outcome: ok({ 'name.definition.function': [{ text: 'f', startLine: 0 }] }) }),
      resolveQuery: () => null,
    }),
  ).toEqual([]);
  expect(
    extractTags({
      ...base,
      code: '',
      runtime: runtimeWith({
        outcome: ok({ 'name.definition.function': [{ text: 'f', startLine: 0 }] }),
      }),
    }),
  ).toEqual([]);
  expect(
    extractTags({
      ...base,
      code: null,
      runtime: runtimeWith({
        outcome: ok({ 'name.definition.function': [{ text: 'f', startLine: 0 }] }),
      }),
    }),
  ).toEqual([]);
});

test('when definitions exist without references, name tokens supply reference tags at line minus one', {
  meta: TAGS_META,
}, () => {
  const tags = extractTags({
    relFname: 'a.py',
    fname: '/repo/a.py',
    code: 'class Helper:\n    def run(self):\n        return Helper()\n',
    runtime: runtimeWith({
      outcome: ok({
        'name.definition.class': [{ text: 'Helper', startLine: 0 }],
        'name.definition.function': [{ text: 'run', startLine: 1 }],
      }),
    }),
    resolveQuery: () => '(class_definition)',
    nameTokens: () => ['Helper', 'run', 'self'],
  });
  const defs = tags.filter((tag) => tag.kind === 'def');
  const refs = tags.filter((tag) => tag.kind === 'ref');
  expect(defs.map((tag) => tag.name)).toEqual(['Helper', 'run']);
  expect(refs.every((tag) => tag.line === -1)).toBe(true);
  expect(refs.map((tag) => tag.name)).toEqual(['Helper', 'run', 'self']);
});

test('Python query assets identify constants, classes, functions, and attribute call names', {
  meta: TAGS_META,
}, () => {
  const scm = readTagsQuery('python', packagedQueryAssetRoots());
  expect(scm).toBeTypeOf('string');
  expect(scm).toContain('@name.definition.constant');
  expect(scm).toContain('@name.definition.class');
  expect(scm).toContain('@name.definition.function');
  expect(scm).toContain('@name.reference.call');
  expect(scm).toContain('attribute: (identifier) @name.reference.call');

  const tags = extractTags({
    relFname: 'mod.py',
    fname: '/repo/mod.py',
    code: 'VALUE = 1\nclass Box:\n    def run(self):\n        obj.method()\n',
    runtime: runtimeWith({
      outcome: (queryScm) => {
        expect(queryScm).toContain('@name.definition.constant');
        return ok({
          'name.definition.constant': [{ text: 'VALUE', startLine: 0 }],
          'name.definition.class': [{ text: 'Box', startLine: 1 }],
          'name.definition.function': [{ text: 'run', startLine: 2 }],
          'name.reference.call': [{ text: 'method', startLine: 3 }],
        });
      },
    }),
    resolveQuery: (lang) => readTagsQuery(lang, packagedQueryAssetRoots()),
  });
  expect(tags).toEqual<Tag[]>([
    { relFname: 'mod.py', fname: '/repo/mod.py', name: 'VALUE', kind: 'def', line: 0 },
    { relFname: 'mod.py', fname: '/repo/mod.py', name: 'Box', kind: 'def', line: 1 },
    { relFname: 'mod.py', fname: '/repo/mod.py', name: 'run', kind: 'def', line: 2 },
    { relFname: 'mod.py', fname: '/repo/mod.py', name: 'method', kind: 'ref', line: 3 },
  ]);
});

test('a parser capture contributes each returned node once rather than appending the final node again', {
  meta: TAGS_META,
}, () => {
  const tags = extractTags({
    relFname: 'a.py',
    fname: '/repo/a.py',
    code: 'f()\ng()\n',
    runtime: runtimeWith({
      outcome: ok({
        'name.reference.call': [
          { text: 'f', startLine: 0 },
          { text: 'g', startLine: 1 },
        ],
      }),
    }),
    resolveQuery: () => '(call)',
  });
  expect(tags.map((tag) => tag.name)).toEqual(['f', 'g']);
  expect(tags.filter((tag) => tag.name === 'g')).toHaveLength(1);
});

test('query selection prefers language-pack tags assets then tree-sitter-languages; missing yields none', {
  meta: TAGS_META,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pm-map-q-'));
  const pack = join(root, 'tree-sitter-language-pack');
  const langs = join(root, 'tree-sitter-languages');
  await mkdir(pack);
  await mkdir(langs);
  await writeFile(join(pack, 'python-tags.scm'), '(pack-python)\n');
  await writeFile(join(langs, 'python-tags.scm'), '(langs-python)\n');
  await writeFile(join(langs, 'julia-tags.scm'), '(langs-julia)\n');
  const roots: QueryAssetRoots = { languagePackDir: pack, languagesDir: langs };

  expect(selectTagsQueryPath('python', roots)).toBe(join(pack, 'python-tags.scm'));
  expect(readTagsQuery('python', roots)).toBe('(pack-python)\n');
  expect(selectTagsQueryPath('julia', roots)).toBe(join(langs, 'julia-tags.scm'));
  expect(readTagsQuery('julia', roots)).toBe('(langs-julia)\n');
  expect(selectTagsQueryPath('missinglang', roots)).toBe(null);
  expect(readTagsQuery('missinglang', roots)).toBe(null);

  expect(selectTagsQueryPath('python', packagedQueryAssetRoots())).toContain('tree-sitter-language-pack/python-tags.scm');
  expect(selectTagsQueryPath('julia', packagedQueryAssetRoots())).toContain('tree-sitter-languages/julia-tags.scm');
});

test('Julia mapping degrades without an uncaught query error when the tags query is incompatible', {
  meta: TAGS_META,
}, () => {
  expect(() =>
    extractTags({
      relFname: 'main.jl',
      fname: '/repo/main.jl',
      code: 'function f()\nend\n',
      runtime: runtimeWith({
        lang: 'julia',
        outcome: { kind: 'query-error', message: 'Query error at 1: incompatible capture' },
      }),
      resolveQuery: (lang) => readTagsQuery(lang, packagedQueryAssetRoots()),
    }),
  ).not.toThrow();
  expect(
    extractTags({
      relFname: 'main.jl',
      fname: '/repo/main.jl',
      code: 'function f()\nend\n',
      runtime: runtimeWith({
        lang: 'julia',
        outcome: { kind: 'query-error', message: 'Query error at 1: incompatible capture' },
      }),
      resolveQuery: (lang) => readTagsQuery(lang, packagedQueryAssetRoots()),
    }),
  ).toEqual([]);
});

test('an install with zero query assets cannot emit definition or reference tags', {
  meta: TAGS_META,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pm-map-empty-q-'));
  const empty: QueryAssetRoots = {
    languagePackDir: join(root, 'missing-pack'),
    languagesDir: join(root, 'missing-langs'),
  };
  const tags = extractTags({
    relFname: 'a.py',
    fname: '/repo/a.py',
    code: 'def f():\n    return 1\n',
    runtime: runtimeWith({
      outcome: ok({ 'name.definition.function': [{ text: 'f', startLine: 0 }] }),
    }),
    resolveQuery: (lang) => readTagsQuery(lang, empty),
  });
  expect(tags).toEqual([]);
  expect(unavailableQueryRuntime.languageFor('a.py')).toBe(null);
  expect(unavailableQueryRuntime.capture({ lang: 'python', code: 'x', queryScm: '(x)' })).toEqual({
    kind: 'unavailable',
  });
});
