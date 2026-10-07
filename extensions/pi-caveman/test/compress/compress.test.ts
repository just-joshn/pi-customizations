// biome-ignore-all lint/security/noSecrets: fixture paths and prompts, not credentials
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  backupDirFor,
  backupPathFor,
  buildCompressPrompt,
  buildFixPrompt,
  compressFile,
  isSensitivePath,
  isSmallerThanBody,
  lockPathFor,
  MAX_RETRIES,
  maskCodeBlocks,
  restoreCodeBlocks,
  splitFrontmatter,
  stripLlmWrapper,
} from '../../src/compress/compress.ts';

let dir = '';
let dataHome = '';

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'caveman-compress-')));
  dataHome = realpathSync(mkdtempSync(join(tmpdir(), 'caveman-data-')));
  vi.stubEnv('XDG_DATA_HOME', dataHome);
  vi.stubEnv('LOCALAPPDATA', dataHome);
});

afterEach(() => {
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

describe('pure helpers', () => {
  test('MAX_RETRIES', () => expect(MAX_RETRIES).toBe(2));

  test('splitFrontmatter', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody\n')).toEqual({ frontmatter: '---\na: 1\n---\n', body: 'body\n' });
    expect(splitFrontmatter('---\r\na: 1\r\n---\r\nbody')).toEqual({ frontmatter: '---\r\na: 1\r\n---\r\n', body: 'body' });
    expect(splitFrontmatter('no frontmatter\n---\n')).toEqual({ frontmatter: '', body: 'no frontmatter\n---\n' });
  });

  test('two separate blocks are left alone', () => {
    const text = '```bash\nnpm install\n```\n\nSome prose.\n\n```bash\nnpm test\n```';
    expect(stripLlmWrapper(text)).toBe(text);
  });
  test('a real wrapper is stripped', () => {
    expect(stripLlmWrapper('```markdown\n# Title\n\nbody text\n```')).toBe('# Title\n\nbody text');
  });
  test('a longer wrapper around inner fences is stripped', () => {
    expect(stripLlmWrapper('````markdown\n# Title\n\n```bash\nls\n```\n````')).toBe('# Title\n\n```bash\nls\n```');
  });

  test('code blocks are masked and restored byte-exact', () => {
    const original = '# Tree\n\nProse before.\n\n```text\nroot\n├── src\n│   └── app.py\n```\n\n    indented()\n    code()\n\nProse after.\n';
    const { masked, blocks } = maskCodeBlocks(original);
    expect(masked.includes('├── src')).toBe(false);
    expect(masked.includes('indented()')).toBe(false);
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.block).toBe('```text\nroot\n├── src\n│   └── app.py\n```\n');
    expect(blocks[1]?.block).toBe('    indented()\n    code()\n\n');
    expect(restoreCodeBlocks(masked, blocks)).toBe(original);
    const compressed = masked.replace('Prose before.', 'Before.').replace('Prose after.', 'After.');
    expect(restoreCodeBlocks(compressed, blocks)).toBe('# Tree\n\nBefore.\n\n```text\nroot\n├── src\n│   └── app.py\n```\n\n    indented()\n    code()\n\nAfter.\n');
  });

  test('marker format', () => {
    const { masked, blocks } = maskCodeBlocks('```sh\necho safe\n```\n');
    expect(blocks.length).toBe(1);
    expect(/^@@CAVEMAN_PRESERVED_CODE_0_[0-9a-f]{16}@@\n$/.test(masked)).toBe(true);
  });

  test('missing or duplicated code marker fails closed', () => {
    const { masked, blocks } = maskCodeBlocks('```sh\necho safe\n```\n');
    const marker = blocks[0]?.marker ?? '';
    expect(() => restoreCodeBlocks(masked.replace(marker, ''), blocks)).toThrow(`Claude changed preserved code marker ${marker}; refusing to write`);
    expect(() => restoreCodeBlocks(masked + marker, blocks)).toThrow('changed preserved code marker');
    expect(() => restoreCodeBlocks('@@CAVEMAN_PRESERVED_CODE_9_x@@', [])).toThrow('the model returned an unknown Caveman code-preservation marker');
    expect(() => maskCodeBlocks('x @@CAVEMAN_PRESERVED_CODE_ y')).toThrow('Input contains reserved Caveman code-preservation marker');
  });

  test('sensitive directory names are blocked', () => {
    expect(isSensitivePath('C:/dev/CREDENTIALS/hetzner/webhosting.md')).toBe(true);
    expect(isSensitivePath('project/secrets/service-notes.md')).toBe(true);
    expect(isSensitivePath('project/secret/service-notes.md')).toBe(true);
    expect(isSensitivePath('project/api-keys/service-notes.md')).toBe(true);
    expect(isSensitivePath('project/private_keys/service-notes.md')).toBe(true);
    expect(isSensitivePath('project/docs/service-notes.md')).toBe(false);
  });

  test('sensitive basenames', () => {
    expect(isSensitivePath('/a/.env.local')).toBe(true);
    expect(isSensitivePath('/a/id_ed25519.pub')).toBe(true);
    expect(isSensitivePath('/a/server.PEM')).toBe(true);
    expect(isSensitivePath('/a/my-token-notes.md')).toBe(true);
    expect(isSensitivePath('/a/notes.md')).toBe(false);
  });

  test('backupDirFor uses XDG_DATA_HOME and falls back to ~/.local/share', () => {
    expect(backupDirFor('/proj/docs/a.md')).toBe(join(dataHome, 'caveman-compress', 'backups', 'docs'));
    expect(backupPathFor('/proj/docs/a.md')).toBe(join(dataHome, 'caveman-compress', 'backups', 'docs', 'a.original.md'));
    vi.stubEnv('XDG_DATA_HOME', '');
    expect(backupDirFor('/proj/docs/a.md')).toBe(join(homedir(), '.local', 'share', 'caveman-compress', 'backups', 'docs'));
  });

  test('lockPathFor is a 16-hex digest under locks', async () => {
    const lock = await lockPathFor('/proj/docs/a.md');
    expect(dirname(lock)).toBe(join(dataHome, 'caveman-compress', 'locks'));
    expect(/^[0-9a-f]{16}\.lock$/.test(lock.slice(dirname(lock).length + 1))).toBe(true);
  });

  test('isSmallerThanBody compares stripped lengths', () => {
    expect(isSmallerThanBody('abc', '  abcd \n')).toBe(true);
    expect(isSmallerThanBody('abcd', 'abcd')).toBe(false);
    expect(isSmallerThanBody('é', 'ab')).toBe(true);
  });

  test('prompts are verbatim', () => {
    expect(buildCompressPrompt('BODY')).toBe(
      '\nCompress this markdown into caveman format.\n\nSTRICT RULES:\n- Do NOT modify anything inside ``` code blocks\n- Do NOT modify anything inside a 4-space-indented code block either — those are code too, and they are validated\n- Do NOT modify anything inside inline backticks\n- Preserve ALL URLs exactly\n- Preserve ALL headings exactly\n- Preserve file paths and commands\n- Return ONLY the compressed markdown body — do NOT wrap the entire output in a ```markdown fence or any other fence. Inner code blocks from the original stay as-is; do not add a new outer fence around the whole file.\n\nOnly compress natural language.\n\nTEXT:\nBODY\n',
    );
    expect(buildFixPrompt('O', 'C', ['e1', 'e2'])).toBe(
      'You are fixing a caveman-compressed markdown file. Specific validation errors were found.\n\nCRITICAL RULES:\n- DO NOT recompress or rephrase the file\n- ONLY fix the listed errors — leave everything else exactly as-is\n- The ORIGINAL is provided as reference only (to restore missing content)\n- Preserve caveman style in all untouched sections\n\nERRORS TO FIX:\n- e1\n- e2\n\nHOW TO FIX:\n- Missing URL: find it in ORIGINAL, restore it exactly where it belongs in COMPRESSED\n- Code block mismatch: find the exact code block in ORIGINAL, restore it in COMPRESSED\n- Heading mismatch: restore the exact heading text from ORIGINAL into COMPRESSED\n- Do not touch any section not mentioned in the errors\n\nORIGINAL (reference only):\nO\n\nCOMPRESSED (fix this):\nC\n\nReturn ONLY the fixed compressed file. No explanation.\n',
    );
  });
});

describe('compressFile guards', () => {
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

  test('retry preamble output rejected and live file untouched', async () => {
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

  test('all validation attempts fail: original untouched, fix prompt carries errors', async () => {
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

  test('missing file, backup file, and code file', async () => {
    const fake = fakeComplete('x');
    const missing = join(dir, 'missing.md');
    expect(await compressFile({ path: missing, complete: fake.complete })).toEqual({
      kind: 'failed',
      errors: [`File not found: ${missing}`],
    });
    const backup = fileWith('# A\n\nprose\n', 'task.original.md');
    expect(await compressFile({ path: backup, complete: fake.complete })).toEqual({ kind: 'skipped', reason: 'Skipping (backup file)' });
    const code = fileWith("print('untouched')\r\n", 'a code file.py');
    expect(await compressFile({ path: code, complete: fake.complete })).toEqual({
      kind: 'skipped',
      reason: 'Skipping (not natural language)',
    });
    expect(readFileSync(code, 'utf8')).toBe("print('untouched')\r\n");
    expect(fake.prompts.length).toBe(0);
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
    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.errors[0]?.startsWith('Compression aborted: Claude changed preserved code marker @@CAVEMAN_PRESERVED_CODE_0_') : 'wrong kind').toBe(true);
    expect(listDir(dir)).toBe('task.md');
  });
});

describe('compressFile success', () => {
  test('real compression writes backup and target', async () => {
    const original = '# Heading\n\nThe quick brown fox jumps over the lazy dog.\n';
    const path = fileWith(original);
    const fake = fakeComplete('# Heading\n\nFox jump dog.\n');
    const backupPath = join(dataHome, 'caveman-compress', 'backups', dirname(path).split('/').at(-1) ?? '', 'task.original.md');
    expect(await compressFile({ path, complete: fake.complete })).toEqual({
      kind: 'compressed',
      path,
      backupPath,
      originalBytes: 56,
      compressedBytes: 24,
    });
    expect(fake.prompts).toEqual([buildCompressPrompt(original)]);
    expect(readFileSync(path, 'utf8')).toBe('# Heading\n\nFox jump dog.');
    expect(readFileSync(backupPath, 'utf8')).toBe(original);
    expect(listDir(dir)).toBe('task.md');
    expect(listDir(dirname(backupPath))).toBe('task.original.md');
    expect(listDir(join(dataHome, 'caveman-compress', 'locks'))).toBe('');
  });

  test('model wrapper fence is stripped', async () => {
    const path = fileWith('# Heading\n\nThe quick brown fox jumps over the lazy dog.\n');
    const result = await compressFile({ path, complete: fakeComplete('```markdown\n# Heading\n\nFox jump dog.\n```\n').complete });
    expect(result.kind).toBe('compressed');
    expect(readFileSync(path, 'utf8')).toBe('# Heading\n\nFox jump dog.');
  });

  test('fix attempt that validates is written', async () => {
    const original = '# Heading\n\n## Sub\n\nThe quick brown fox jumps over the lazy dog.\n';
    const path = fileWith(original);
    const fake = fakeComplete('# Heading\n\nFox jump dog.\n', '# Heading\n\n## Sub\n\nFox jump dog.\n');
    const result = await compressFile({ path, complete: fake.complete });
    expect(result.kind).toBe('compressed');
    expect(fake.prompts.length).toBe(2);
    expect(readFileSync(path, 'utf8')).toBe('# Heading\n\n## Sub\n\nFox jump dog.');
  });

  test('UTF-8 round trip', async () => {
    const original = '# Heading\n\nCafé, 中文, and an arrow → here.\n';
    const path = fileWith(original);
    await compressFile({ path, complete: fakeComplete('# Heading\n\nCafé 中文 arrow → here.\n').complete });
    expect(readFileSync(path, 'utf8')).toBe('# Heading\n\nCafé 中文 arrow → here.');
    expect(readFileSync(backupPathFor(path), 'utf8')).toBe(original);
  });

  test('frontmatter preserved verbatim and BOM kept', async () => {
    const original = '\ufeff# Heading\n\nThe quick brown fox jumps over the lazy dog.\n';
    const path = fileWith(original);
    await compressFile({ path, complete: fakeComplete('\ufeff# Heading\n\nFox jump dog.').complete });
    expect(readFileSync(path, 'utf8')).toBe('\ufeff# Heading\n\nFox jump dog.');

    const fm = '---\nname: x\n---\n';
    const path2 = fileWith(`${fm}# Heading\n\nThe quick brown fox jumps over the lazy dog.\n`, 'other.md');
    const fake = fakeComplete('# Heading\n\nFox jump dog.');
    await compressFile({ path: path2, complete: fake.complete });
    expect(fake.prompts).toEqual([buildCompressPrompt('# Heading\n\nThe quick brown fox jumps over the lazy dog.\n')]);
    expect(readFileSync(path2, 'utf8')).toBe(`${fm}# Heading\n\nFox jump dog.`);
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
    expect(readFileSync(path, 'utf8')).toBe('# Title\r\n\r\nShort body.');
    expect(readFileSync(backupPathFor(path)).equals(raw)).toBe(true);
  });

  test('one CRLF line does not convert an LF document', async () => {
    const raw = Buffer.from('# Title\nline one\r\nline two\nlong prose body to compress.\n');
    const path = fileWith(raw);
    await compressFile({ path, complete: fakeComplete('# Title\n\nShort body.\n').complete });
    expect(readFileSync(path, 'utf8')).toBe('# Title\n\nShort body.');
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
});
