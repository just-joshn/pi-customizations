import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { decisionLog } from './lib/checks.ts';
import { loadView } from './lib/driver.ts';

test.for([true, false])('a run-less audit trail is loaded and validated (%s)', (valid) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'runless-trail-'));
  try {
    mkdirSync(join(sandbox, 'repo/.audit'), { recursive: true });
    mkdirSync(join(sandbox, 'sessions'));
    writeFileSync(join(sandbox, 'meta.json'), JSON.stringify({ family: 'show-me-your-work', driver: 'real', base: 'base', parentSessionFile: null, prompt: '/show-me-your-work' }));
    writeFileSync(join(sandbox, 'git.json'), '{}');
    writeFileSync(join(sandbox, 'repo/.audit/review.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n2026-11-14T00:00:00Z\tRead\tinspect\tunderstand\t${valid ? 'src/cart.js:1' : ''}\tread\n`);
    const view = loadView(sandbox);
    expect(view.runs).toEqual([]);
    expect(decisionLog('trail', { file: 'show-me-your-work/SKILL.md', anchor: 'The log' }, { min: 1 }).run(view)).toMatchObject({ ok: valid });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
