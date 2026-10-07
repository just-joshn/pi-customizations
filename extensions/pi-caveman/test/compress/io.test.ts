import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { exists, firstInvalidUtf8Offset, hasCode, isSymlink, readSource, removeQuietly, renderText, resolvePath, writeBytesAtomic } from '../../src/compress/io.ts';

let dir = '';
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'caveman-io-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test.for([
  { label: 'empty input', bytes: [], offset: -1 },
  { label: 'ASCII', bytes: [0x61, 0x62], offset: -1 },
  { label: 'two-byte é', bytes: [0x61, 0xc3, 0xa9], offset: -1 },
  { label: 'three-byte €', bytes: [0xe2, 0x82, 0xac], offset: -1 },
  { label: 'four-byte emoji', bytes: [0xf0, 0x9f, 0x98, 0x80], offset: -1 },
  { label: 'lone latin1 byte', bytes: [0x61, 0xe9], offset: 1 },
  { label: 'overlong lead 0xc0', bytes: [0xc0, 0x80], offset: 0 },
  { label: 'bad continuation', bytes: [0xc3, 0x41], offset: 0 },
  { label: 'overlong three-byte', bytes: [0xe0, 0x80, 0x80], offset: 0 },
  { label: 'surrogate', bytes: [0xed, 0xa0, 0x80], offset: 0 },
  { label: 'above U+10FFFF', bytes: [0xf4, 0x90, 0x80, 0x80], offset: 0 },
  { label: 'lead 0xf5', bytes: [0xf5, 0x80, 0x80, 0x80], offset: 0 },
])('firstInvalidUtf8Offset handles $label', ({ bytes, offset }) => {
  expect(firstInvalidUtf8Offset(Uint8Array.from(bytes))).toBe(offset);
});

test('readSource reports a CRLF-majority file as CRLF', async () => {
  const path = join(dir, 'a.md');
  writeFileSync(path, 'a\r\nb\r\n');
  const source = await readSource(path);
  expect([source.text, source.newline]).toEqual(['a\nb\n', '\r\n']);
});
test('readSource converts lone CR to LF', async () => {
  const path = join(dir, 'a.md');
  writeFileSync(path, 'a\rb');
  expect((await readSource(path)).text).toBe('a\nb');
});
test('readSource reads an empty file', async () => {
  const path = join(dir, 'a.md');
  writeFileSync(path, '');
  const source = await readSource(path);
  expect([source.text, source.newline, source.raw.length]).toEqual(['', '\n', 0]);
});
test('readSource rejects invalid UTF-8 with the offending byte', async () => {
  const path = join(dir, 'a.md');
  writeFileSync(path, Buffer.from([0x61, 0xff]));
  await expect(readSource(path)).rejects.toThrow(`Refusing to compress ${path}: not valid UTF-8 (byte 0xff at offset 1).`);
});

test('renderText keeps LF text unchanged', () => {
  expect(renderText('a\nb', '\n').toString('utf8')).toBe('a\nb');
});
test('renderText converts mixed endings to CRLF', () => {
  expect(renderText('a\r\nb\nc', '\r\n').toString('utf8')).toBe('a\r\nb\r\nc');
});
test('renderText renders the empty string to zero bytes', () => {
  expect(renderText('', '\r\n').length).toBe(0);
});

test('writeBytesAtomic creates a new file without temp leftovers', async () => {
  const path = join(dir, 'new.md');
  await writeBytesAtomic(path, Buffer.from('hi'));
  expect([readFileSync(path, 'utf8'), readdirSync(dir).join(',')]).toEqual(['hi', 'new.md']);
});
test.skipIf(process.platform === 'win32')('writeBytesAtomic keeps the existing file mode', async () => {
  const path = join(dir, 'old.md');
  writeFileSync(path, 'old');
  chmodSync(path, 0o640);
  await writeBytesAtomic(path, Buffer.from('new'));
  expect(statSync(path).mode & 0o777).toBe(0o640);
});
test('writeBytesAtomic removes its temp file when the rename fails', async () => {
  const target = join(dir, 'target');
  mkdirSync(target);
  writeFileSync(join(target, 'keep'), '');
  await expect(writeBytesAtomic(target, Buffer.from('x'))).rejects.toThrow(/EISDIR|ENOTEMPTY|EEXIST|EPERM/);
  expect(readdirSync(dir).join(',')).toBe('target');
});

test('resolvePath falls back to lexical resolution for a missing path', async () => {
  expect(await resolvePath(join(dir, 'nope', '..', 'x.md'))).toBe(join(dir, 'x.md'));
});
test('exists is false for a missing path', async () => {
  expect(await exists(join(dir, 'missing'))).toBe(false);
});
test('isSymlink is true for a symlink', async () => {
  symlinkSync(dir, join(dir, 'link'));
  expect(await isSymlink(join(dir, 'link'))).toBe(true);
});
test('isSymlink is false for a missing path', async () => {
  expect(await isSymlink(join(dir, 'missing'))).toBe(false);
});
test('removeQuietly tolerates a missing file', async () => {
  await expect(removeQuietly(join(dir, 'missing'))).resolves.toBe(undefined);
});
test('hasCode is false for a non-Error value', () => {
  expect(hasCode({ code: 'ENOENT' }, 'ENOENT')).toBe(false);
});
