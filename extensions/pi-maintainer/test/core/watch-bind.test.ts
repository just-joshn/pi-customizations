import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  FileWatcher,
  getAiComments,
  loadGitignores,
  type WatchChange,
  type WatchMonitor,
} from '../../src/core/watch.ts';

const fixtures = join(import.meta.dirname, '../fixtures/watch');
const readText = (path: string): string => readFileSync(path, 'utf8');

test(
  'built-in and gitignore patterns exclude editor noise and keep source files',
  {
    meta: {
      aider: ['test_watch/test_gitignore_patterns'],
    },
  },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-watch-ignore-'));
    const gitignore = join(dir, 'test.gitignore');
    writeFileSync(gitignore, 'custom_pattern\n*.custom\n');
    const spec = loadGitignores([gitignore]);
    expect(spec).not.toBeNull();
    const ignored = [
      '.aider.conf',
      '.git/config',
      'file~',
      'file.bak',
      'file.swp',
      'file.swo',
      '#temp#',
      '.#lock',
      'temp.tmp',
      'temp.temp',
      'conflict.orig',
      'script.pyc',
      '__pycache__/module.pyc',
      '.DS_Store',
      'Thumbs.db',
      '.idea/workspace.xml',
      '.vscode/settings.json',
      'project.sublime-workspace',
      '.project',
      '.settings/config.json',
      'workspace.code-workspace',
      '.env',
      '.venv/bin/python',
      'node_modules/package/index.js',
      'vendor/lib/module.py',
      'debug.log',
      '.cache/files',
      '.pytest_cache/v/cache',
      'coverage/lcov.info',
      'custom_pattern',
      'file.custom',
    ];
    for (const path of ignored) expect(spec?.matchFile(path)).toBe(true);
    expect(spec?.matchFile('regular_file.txt')).toBe(false);
    expect(spec?.matchFile('src/main.py')).toBe(false);
    expect(spec?.matchFile('docs/index.html')).toBe(false);
  },
);

test(
  'watcher roots exclude ignored top-level entries and fall back to the root',
  {
    meta: {
      aider: ['test_watch/test_get_roots_to_watch'],
    },
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'pm-watch-roots-'));
    mkdirSync(join(root, 'included'));
    mkdirSync(join(root, 'excluded'));
    const plain = new FileWatcher({ root, readText: () => '', interruptInput: () => {} });
    expect(plain.getRootsToWatch()).toEqual([root]);

    const gitignore = join(root, '.gitignore');
    writeFileSync(gitignore, 'excluded/\n');
    const filtered = new FileWatcher({ root, gitignores: [gitignore], readText: () => '', interruptInput: () => {} });
    const roots = filtered.getRootsToWatch().map((path) => path.split('/').at(-1)).sort();
    expect(roots).toEqual(['.gitignore', 'included']);
  },
);

test(
  'empty notifications leave state alone while nonempty paths interrupt input',
  {
    meta: {
      aider: ['test_watch/test_handle_changes'],
    },
  },
  () => {
    const interrupts: number[] = [];
    const watcher = new FileWatcher({
      root: '.',
      readText: () => '',
      interruptInput: () => {
        interrupts.push(1);
      },
    });
    expect(watcher.handleChanges([])).toBe(false);
    expect([...watcher.changedFiles]).toEqual([]);
    expect(interrupts).toEqual([]);

    const changes: WatchChange[] = [['modified', '/path/to/file.py']];
    expect(watcher.handleChanges(changes)).toBe(true);
    expect([...watcher.changedFiles]).toEqual(['/path/to/file.py']);
    expect(interrupts).toEqual([1]);
  },
);

test(
  'AI comment markers yield one-based lines and the last actionable bang or question',
  {
    meta: {
      aider: ['test_watch/test_ai_comment_pattern'],
    },
  },
  () => {
    const py = getAiComments(join(fixtures, 'watch.py'), readText);
    expect(py).not.toBeNull();
    const uniquePy = new Set(py?.comments.map((comment) => comment.trim().toLowerCase()) ?? []);
    expect(uniquePy.size).toBe(10);
    expect(py?.action).toBe('!');

    const js = getAiComments(join(fixtures, 'watch.js'), readText);
    expect(js?.lineNums).toHaveLength(16);
    expect(js?.action).toBe('!');

    const question = getAiComments(join(fixtures, 'watch_question.js'), readText);
    expect(question?.lineNums).toHaveLength(6);
    expect(question?.action).toBe('?');

    const lisp = getAiComments(join(fixtures, 'watch.lisp'), readText);
    expect(lisp?.lineNums).toHaveLength(7);
    expect(lisp?.action).toBe('!');
  },
);

test(
  'filter keeps under-root AI-comment files under one MiB and drops ignored paths',
  {
    meta: {
      aider: ['test_watch/test_gitignore_patterns'],
    },
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'pm-watch-filter-'));
    const gitignore = join(root, '.gitignore');
    writeFileSync(gitignore, '');
    writeFileSync(join(root, 'ok.py'), '# ai fix this\n');
    writeFileSync(join(root, 'noise.log'), '# ai fix this\n');
    writeFileSync(join(root, 'huge.py'), `# ai\n${'x'.repeat(1024 * 1024)}\n`);
    writeFileSync(join(root, 'plain.py'), 'print(1)\n');
    const watcher = new FileWatcher({
      root,
      gitignores: [gitignore],
      readText,
      interruptInput: () => {},
    });
    expect(watcher.filterPath('change', join(root, 'ok.py'))).toBe(true);
    expect(watcher.filterPath('change', join(root, 'noise.log'))).toBe(false);
    expect(watcher.filterPath('change', join(root, 'huge.py'))).toBe(false);
    expect(watcher.filterPath('change', join(root, 'plain.py'))).toBe(false);
    expect(watcher.filterPath('change', '/tmp/outside.py')).toBe(false);
  },
);

test('starting clears pending changes and stop joins the monitor before discarding it', () => {
  const events: string[] = [];
  let stopped = false;
  const monitor: WatchMonitor = {
    start() {
      events.push('start');
    },
    stop() {
      events.push('stop');
      stopped = true;
    },
    join() {
      events.push('join');
      expect(stopped).toBe(true);
    },
  };
  const watcher = new FileWatcher({
    root: '.',
    readText: () => '',
    interruptInput: () => {},
    createMonitor: () => monitor,
  });
  watcher.handleChanges([['modified', '/a.py']]);
  expect(watcher.changedFiles.size).toBe(1);
  watcher.start();
  expect([...watcher.changedFiles]).toEqual([]);
  expect(events).toEqual(['start']);
  watcher.stop();
  expect(events).toEqual(['start', 'stop', 'join']);
  expect(watcher.hasMonitor).toBe(false);
});
