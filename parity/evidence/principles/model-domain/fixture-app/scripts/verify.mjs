#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');

const mod = await import(`${pathToFileURL(join(root, 'src', 'ticket.js')).href}?t=${Date.now()}`);
const { createDraft, open, close, label, hold, release } = mod;

const failures = [];
const check = (name, cond) => {
  if (!cond) failures.push(name);
};

try {
  const draft = createDraft();
  check('draft-label', label(draft) === 'DRAFT');

  const opened = open(draft);
  check('open-label', label(opened) === 'OPEN');

  if (typeof hold !== 'function' || typeof release !== 'function') {
    failures.push('missing-hold-or-release');
  } else {
    const held = hold(opened);
    check('held-label', label(held) === 'HELD');

    let closeHeldError = null;
    try {
      close(held);
    } catch (e) {
      closeHeldError = e instanceof Error ? e.message : String(e);
    }
    check('close-held-rejected', closeHeldError != null);

    const released = release(held);
    check('release-label', label(released) === 'OPEN');

    const closed = close(released);
    check('closed-label', label(closed) === 'CLOSED');

    let holdDraftError = null;
    try {
      hold(createDraft());
    } catch (e) {
      holdDraftError = e instanceof Error ? e.message : String(e);
    }
    check('hold-draft-rejected', holdDraftError != null);
  }
} catch (e) {
  failures.push(`exception:${e instanceof Error ? e.message : String(e)}`);
}

const ok = failures.length === 0;
const line = ok
  ? 'DOMAIN-OK hold=held-label close-held=rejected release=open'
  : `DOMAIN-FAIL failures=${failures.join(',')}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
