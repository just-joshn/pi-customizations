import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { guiDigest } from './resource-workflows-gui-lease.mjs';

const ROOT = '/tmp/f016-fixed-eeb7e22f';
const INDEX_SHA256 = '24eac0b105d0a39287eca17c252b5534fdf67efc91bdc34ee2866b8ab41c9c9a';

async function fileHash(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('sealed source must be regular');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path, { highWaterMark: 1024 * 1024 })) hash.update(bytes);
  return hash.digest('hex');
}

export async function inspectGuiSource() {
  const expected = JSON.parse(await readFile(new URL('./resource-workflows-gui-source-seal.json', import.meta.url), 'utf8'));
  const directory = await realpath(ROOT);
  const hashes = Object.freeze(Object.fromEntries(await Promise.all(Object.entries(expected).map(async ([name, sha256]) => {
    const digest = await fileHash(join(directory, name));
    if (digest !== sha256) throw new Error(`GUI source seal mismatch ${name}`);
    return [name, digest];
  }))));
  const indexSha256 = await fileHash(join(directory, 'ARTIFACTS.tsv'));
  if (indexSha256 !== INDEX_SHA256) throw new Error('GUI source index mismatch');
  return Object.freeze({ sourceRoot: directory, hashes, indexSha256, manifestSha256: guiDigest(JSON.stringify(hashes)), application: Object.freeze({ 'index.html': hashes['index.html'] }), execution: 'scratch Electron only', browser: 'scripted headless supplement only' });
}

export function requireGuiBinding(kind, application, source) {
  if (kind === 'playwright') throw new Error('independent Chromium window/session application binding unavailable');
  if (JSON.stringify(application) !== JSON.stringify(source.application)) throw new Error('sealed application binding unavailable; seeded project differs from scratch fixture');
}
