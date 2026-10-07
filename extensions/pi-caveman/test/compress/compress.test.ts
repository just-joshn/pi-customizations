// biome-ignore-all lint/security/noSecrets: fixture paths and prompts, not credentials
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { compressFile, MAX_FILE_SIZE, MAX_RETRIES } from '../../src/compress/compress.ts';
import { lockPathFor } from '../../src/compress/lock.ts';
import { backupDirFor, backupPathFor } from '../../src/compress/paths.ts';
import { buildCompressPrompt, buildFixPrompt } from '../../src/compress/text.ts';

let dir = '';
let dataHome = '';

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'caveman-compress-')));
  dataHome = realpathSync(mkdtempSync(join(tmpdir(), 'caveman-data-')));
  vi.stubEnv('XDG_DATA_HOME', dataHome);
  vi.stubEnv('LOCALAPPDATA', dataHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  rmSync(dataHome, { recursive: true, force: true });
});

function fileWith(content: string | Buffer, name = 'task.md'): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

function fakeComplete(...responses: string[]) {
  const prompts: string[] = [];
  const complete = async (prompt: string): Promise<string> => {
    prompts.push(prompt);
    const next = responses[Math.min(prompts.length - 1, responses.length - 1)];
    return next ?? '';
  };
  return { prompts, complete };
}

function listDir(path: string): string {
  return existsSync(path) ? readdirSync(path).sort().join(',') : '<missing>';
}

test('empty input refused without calling the model', async () => {
  const path = fileWith('');
  const fake = fakeComplete('x');
  expect(await compressFile({ path, complete: fake.complete })).toEqual({
    kind: 'skipped',
    reason: 'Refusing to compress: file is empty or whitespace-only.',
  });
  expect(fake.prompts.length).toBe(0);
  expect(readFileSync(path, 'utf8')).toBe('');
  expect(listDir(dir)).toBe('task.md');
});

test.each([
  ['empty output', '# Heading\n\nSome long natural language paragraph that should be compressed.\n', '', 'Compression aborted: the model returned an empty response.'],
  ['whitespace output', '# Heading\n\nProse that should change.\n', '   \n  ', 'Compression aborted: the model returned an empty response.'],
  ['identical output', '# Heading\n\nProse.\n', '# Heading\n\nProse.\n', 'Compression aborted: output is identical to input.'],
  ['expanded output', '# Heading\n\nFox jump dog.\n', '# Heading\n\nThe quick brown fox jumps over the lazy dog, repeatedly.\n', 'Compression aborted: output is not smaller than input (67 >= 24 chars).'],
  ['same-length output', '# Heading\n\nFox jump dog now.\n', '# Heading\n\nDog jump fox now.\n', 'Compression aborted: output is not smaller than input (28 >= 28 chars).'],
])('%s does not touch disk', async (_label, original, response, error) => {
  const path = fileWith(original);
  const fake = fakeComplete(response);
  expect(await compressFile({ path, complete: fake.complete })).toEqual({ kind: 'failed', errors: [error] });
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(listDir(dir)).toBe('task.md');
  expect(listDir(join(dataHome, 'caveman-compress', 'backups'))).toBe('<missing>');
});

test('expanded retry candidate does not touch disk', async () => {
  const original = '# Heading\n\n## Sub\n\nThe quick brown fox jumps over the lazy dog.\n';
  const first = '# Heading\n\nFox jump dog.\n';
  const repair = '# Heading\n\n## Sub\n\nThe quick brown fox jumps over the lazy dog, and then jumps over it again, repeatedly and at length.\n';
  const path = fileWith(original);
  const fake = fakeComplete(first, repair, repair);
  expect(await compressFile({ path, complete: fake.complete })).toEqual({
    kind: 'failed',
    errors: ['Heading count mismatch: 2 vs 1'],
  });
  expect(fake.prompts.length).toBe(2);
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(existsSync(backupPathFor(path))).toBe(false);
  expect(listDir(dir)).toBe('task.md');
});

test('retry with a leaked preamble is rejected', async () => {
  const original = '# Heading\n\n## Sub\n\nProse that fails validation, long enough.\n';
  const path = fileWith(original);
  const fake = fakeComplete('# Heading\n\nCompressed prose.\n', 'Here is the fixed file:\n\n# Heading\n\n## Sub\n\nProse.\n');
  expect(await compressFile({ path, complete: fake.complete })).toEqual({
    kind: 'failed',
    errors: ['Heading count mismatch: 2 vs 1'],
  });
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(existsSync(backupPathFor(path))).toBe(false);
});

test('exhausted validation retries leave the original untouched', async () => {
  const original = '# Heading\n\n## Sub\n\nProse to compress, long enough to pass the identity check here.\n';
  const path = fileWith(original);
  const fake = fakeComplete('# Heading\n\nProse.\n');
  expect(await compressFile({ path, complete: fake.complete })).toEqual({
    kind: 'failed',
    errors: ['Heading count mismatch: 2 vs 1'],
  });
  expect(fake.prompts.length).toBe(MAX_RETRIES);
  expect(fake.prompts[1]).toBe(buildFixPrompt(original, '# Heading\n\nProse.', ['Heading count mismatch: 2 vs 1']));
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(listDir(dir)).toBe('task.md');
  expect(existsSync(backupPathFor(path))).toBe(false);
});

test('a fix call that throws removes the backup', async () => {
  const original = '# Heading\n\n## Sub\n\nProse to compress, long enough to pass the identity check here.\n';
  const path = fileWith(original);
  let calls = 0;
  const complete = async (): Promise<string> => {
    calls++;
    if (calls === 1) return '# Heading\n\nProse.\n';
    throw new Error('provider down');
  };
  await expect(compressFile({ path, complete })).rejects.toThrow('provider down');
  expect([readFileSync(path, 'utf8'), existsSync(backupPathFor(path))]).toStrictEqual([original, false]);
});

test('non-UTF-8 input refused before anything is written', async () => {
  const raw = Buffer.from('# Notes\n\nCaf\xe9 build steps are long and prose-like.\n', 'latin1');
  const path = fileWith(raw);
  const fake = fakeComplete('x');
  expect(await compressFile({ path, complete: fake.complete })).toEqual({
    kind: 'failed',
    errors: [`Refusing to compress ${path}: not valid UTF-8 (byte 0xe9 at offset 12). Compression rewrites the file in place, and any byte this tool cannot decode would be destroyed by the round trip. Convert the file to UTF-8 first.`],
  });
  expect(fake.prompts.length).toBe(0);
  expect(readFileSync(path).equals(raw)).toBe(true);
  expect(existsSync(backupPathFor(path))).toBe(false);
});

test('sensitive path refused', async () => {
  mkdirSync(join(dir, 'secrets'));
  const path = fileWith('# A\n\nprose\n', 'secrets/notes.md');
  const fake = fakeComplete('x');
  expect(await compressFile({ path, complete: fake.complete })).toEqual({
    kind: 'failed',
    errors: [`Refusing to compress ${path}: filename looks sensitive (credentials, keys, secrets, or known private paths). Compression sends file contents to the model provider. Rename the file if this is a false positive.`],
  });
  expect(fake.prompts.length).toBe(0);
});

test('missing file is reported as not found', async () => {
  const missing = join(dir, 'missing.md');
  expect(await compressFile({ path: missing, complete: fakeComplete('x').complete })).toEqual({ kind: 'failed', errors: [`File not found: ${missing}`] });
});

test('backup file is skipped', async () => {
  const backup = fileWith('# A\n\nprose\n', 'task.original.md');
  expect(await compressFile({ path: backup, complete: fakeComplete('x').complete })).toEqual({ kind: 'skipped', reason: 'Skipping (backup file)' });
});

test('code file is skipped without calling the model', async () => {
  const fake = fakeComplete('x');
  const code = fileWith("print('untouched')\r\n", 'a code file.py');
  expect(await compressFile({ path: code, complete: fake.complete })).toEqual({ kind: 'skipped', reason: 'Skipping (not natural language)' });
  expect([readFileSync(code, 'utf8'), fake.prompts.length]).toEqual(["print('untouched')\r\n", 0]);
});

test('relative path resolves against the working directory', async () => {
  const path = fileWith('# Heading\n\nThe quick brown fox jumps over the lazy dog.\n');
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  const result = await compressFile({ path: 'task.md', complete: fakeComplete('# Heading\n\nFox jump dog.').complete });
  expect(result.kind === 'compressed' ? result.path : result.kind).toBe(path);
});

test('file of exactly MAX_FILE_SIZE bytes is compressed', async () => {
  const head = '# Heading\n\n';
  const line = 'lorem ipsum\n';
  const body = line.repeat(Math.floor((MAX_FILE_SIZE - head.length) / line.length));
  const path = fileWith(head + body + 'x'.repeat(MAX_FILE_SIZE - head.length - body.length));
  const result = await compressFile({ path, complete: fakeComplete('# Heading\n\nshort').complete });
  expect(result.kind === 'compressed' ? result.originalBytes : result.kind).toBe(MAX_FILE_SIZE);
});

test('file one byte over MAX_FILE_SIZE is refused', async () => {
  const path = fileWith('a'.repeat(MAX_FILE_SIZE + 1));
  expect(await compressFile({ path, complete: fakeComplete('x').complete })).toEqual({
    kind: 'failed',
    errors: [`File too large to compress safely (max 500KB): ${path}`],
  });
});

test('whitespace-only input is refused', async () => {
  const path = fileWith(' \n\t\n');
  expect(await compressFile({ path, complete: fakeComplete('x').complete })).toEqual({ kind: 'skipped', reason: 'Refusing to compress: file is empty or whitespace-only.' });
});

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('unreadable file is reported as failed', async () => {
  const path = fileWith('# Heading\n\nprose\n');
  chmodSync(path, 0o000);
  const result = await compressFile({ path, complete: fakeComplete('x').complete });
  chmodSync(path, 0o600);
  expect(result.kind === 'failed' ? result.errors[0]?.split(':')[0] : result.kind).toBe('EACCES');
});

test('existing backup aborts', async () => {
  const path = fileWith('# Heading\n\nThe quick brown fox jumps over the lazy dog.\n');
  mkdirSync(backupDirFor(path), { recursive: true });
  writeFileSync(backupPathFor(path), 'older backup');
  const fake = fakeComplete('x');
  expect(await compressFile({ path, complete: fake.complete })).toEqual({
    kind: 'skipped',
    reason: `Backup file already exists: ${backupPathFor(path)}. Aborting to prevent data loss. Please remove or rename the backup file if you want to proceed.`,
  });
  expect(readFileSync(backupPathFor(path), 'utf8')).toBe('older backup');
});

test('body empty after frontmatter', async () => {
  const path = fileWith('---\na: 1\n---\n\n');
  expect(await compressFile({ path, complete: fakeComplete('x').complete })).toEqual({
    kind: 'skipped',
    reason: 'Refusing to compress: body is empty after frontmatter removal.',
  });
});

test('model that drops a code marker fails closed', async () => {
  const path = fileWith('# H\n\nSome prose that is long enough here.\n\n```sh\nrm -rf build\n```\n');
  const result = await compressFile({ path, complete: fakeComplete('# H\n\nProse.\n').complete });
  expect(result.kind === 'failed' ? result.errors[0]?.startsWith('Compression aborted: Claude changed preserved code marker @@CAVEMAN_PRESERVED_CODE_0_') : result.kind).toBe(true);
  expect(listDir(dir)).toBe('task.md');
});

test('successful compression writes the backup beside the target', async () => {
  const original = '# Heading\n\nThe quick brown fox jumps over the lazy dog.\n';
  const path = fileWith(original);
  const fake = fakeComplete('# Heading\n\nFox jump dog.\n');
  const backupPath = join(dataHome, 'caveman-compress', 'backups', dirname(path).split('/').at(-1) ?? '', 'task.original.md');
  expect(await compressFile({ path, complete: fake.complete })).toEqual({
    kind: 'compressed',
    path,
    backupPath,
    originalBytes: 56,
    compressedBytes: 25,
  });
  expect(fake.prompts).toEqual([buildCompressPrompt(original)]);
  expect(readFileSync(path, 'utf8')).toBe('# Heading\n\nFox jump dog.\n');
  expect(readFileSync(backupPath, 'utf8')).toBe(original);
  expect(listDir(dir)).toBe('task.md');
  expect(listDir(dirname(backupPath))).toBe('task.original.md');
  expect(listDir(join(dataHome, 'caveman-compress', 'locks'))).toBe('');
});

test('compressed file keeps the trailing newline the source had', async () => {
  const original = '# Heading\n\nThe quick brown fox jumps over the lazy dog.\n';
  const path = fileWith(original);
  const result = await compressFile({ path, complete: fakeComplete('# Heading\n\nFox jump dog.\n').complete });
  expect(result.kind).toBe('compressed');
  expect(readFileSync(path, 'utf8')).toBe('# Heading\n\nFox jump dog.\n');
});

test('compressed file does not gain a trailing newline the source lacked', async () => {
  const original = '# Heading\n\nThe quick brown fox jumps over the lazy dog.';
  const path = fileWith(original);
  const result = await compressFile({ path, complete: fakeComplete('# Heading\n\nFox jump dog.\n').complete });
  expect(result.kind).toBe('compressed');
  expect(readFileSync(path, 'utf8')).toBe('# Heading\n\nFox jump dog.');
});

test('model wrapper fence is stripped', async () => {
  const path = fileWith('# Heading\n\nThe quick brown fox jumps over the lazy dog.\n');
  const result = await compressFile({ path, complete: fakeComplete('```markdown\n# Heading\n\nFox jump dog.\n```\n').complete });
  expect(result.kind).toBe('compressed');
  expect(readFileSync(path, 'utf8')).toBe('# Heading\n\nFox jump dog.\n');
});

test('fix attempt that validates is written', async () => {
  const original = '# Heading\n\n## Sub\n\nThe quick brown fox jumps over the lazy dog.\n';
  const path = fileWith(original);
  const fake = fakeComplete('# Heading\n\nFox jump dog.\n', '# Heading\n\n## Sub\n\nFox jump dog.\n');
  const result = await compressFile({ path, complete: fake.complete });
  expect(result.kind).toBe('compressed');
  expect(fake.prompts.length).toBe(2);
  expect(readFileSync(path, 'utf8')).toBe('# Heading\n\n## Sub\n\nFox jump dog.\n');
});

test('UTF-8 round trip', async () => {
  const original = '# Heading\n\nCafé, 中文, and an arrow → here.\n';
  const path = fileWith(original);
  await compressFile({ path, complete: fakeComplete('# Heading\n\nCafé 中文 arrow → here.\n').complete });
  expect(readFileSync(path, 'utf8')).toBe('# Heading\n\nCafé 中文 arrow → here.\n');
  expect(readFileSync(backupPathFor(path), 'utf8')).toBe(original);
});

test('leading BOM is kept', async () => {
  const path = fileWith('\ufeff# Heading\n\nThe quick brown fox jumps over the lazy dog.\n');
  await compressFile({ path, complete: fakeComplete('\ufeff# Heading\n\nFox jump dog.').complete });
  expect(readFileSync(path, 'utf8')).toBe('\ufeff# Heading\n\nFox jump dog.\n');
});

test('frontmatter is preserved verbatim', async () => {
  const fm = '---\nname: x\n---\n';
  const path = fileWith(`${fm}# Heading\n\nThe quick brown fox jumps over the lazy dog.\n`);
  const fake = fakeComplete('# Heading\n\nFox jump dog.');
  await compressFile({ path, complete: fake.complete });
  expect(fake.prompts).toEqual([buildCompressPrompt('# Heading\n\nThe quick brown fox jumps over the lazy dog.\n')]);
  expect(readFileSync(path, 'utf8')).toBe(`${fm}# Heading\n\nFox jump dog.\n`);
});

test.skipIf(process.platform === 'win32')('permission bits preserved', async () => {
  const path = fileWith('# Heading\n\nProse to compress.\n');
  chmodSync(path, 0o640);
  const result = await compressFile({ path, complete: fakeComplete('# Heading\n\nProse.\n').complete });
  expect(result.kind).toBe('compressed');
  expect(statSync(path).mode & 0o777).toBe(0o640);
});

test('CRLF line endings survive the round trip', async () => {
  const raw = Buffer.from('# Title\r\n\r\nSome long prose body to compress here.\r\n');
  const path = fileWith(raw);
  await compressFile({ path, complete: fakeComplete('# Title\n\nShort body.\n').complete });
  expect(readFileSync(path, 'utf8')).toBe('# Title\r\n\r\nShort body.\r\n');
  expect(readFileSync(backupPathFor(path)).equals(raw)).toBe(true);
});

test('one CRLF line does not convert an LF document', async () => {
  const raw = Buffer.from('# Title\nline one\r\nline two\nlong prose body to compress.\n');
  const path = fileWith(raw);
  await compressFile({ path, complete: fakeComplete('# Title\n\nShort body.\n').complete });
  expect(readFileSync(path, 'utf8')).toBe('# Title\n\nShort body.\n');
  expect(readFileSync(backupPathFor(path)).equals(raw)).toBe(true);
});

test('stale lock from a dead pid is reclaimed', async () => {
  const path = fileWith('# Heading\n\nThe quick brown fox jumps over the lazy dog.\n');
  const lock = await lockPathFor(path);
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, '2147483646');
  const result = await compressFile({ path, complete: fakeComplete('# Heading\n\nFox jump dog.').complete });
  expect(result.kind).toBe('compressed');
  expect(existsSync(lock)).toBe(false);
});

test('live lock waits until aborted', async () => {
  const path = fileWith('# Heading\n\nThe quick brown fox jumps over the lazy dog.\n');
  const lock = await lockPathFor(path);
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, String(process.pid));
  const controller = new AbortController();
  const fake = fakeComplete('x');
  const pending = compressFile({ path, complete: fake.complete, signal: controller.signal });
  controller.abort(new Error('stop'));
  await expect(pending).rejects.toThrow('stop');
  expect(fake.prompts.length).toBe(0);
  expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
});
