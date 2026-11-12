import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { buildRecords, loadInputs } from '../../scripts/parity-lib.mjs';
import { fixture } from '../skill-parity/helpers.ts';
import { type MiniRoot, miniRoot, PKG, SKILL, script } from './helpers.ts';

let mini: MiniRoot;
let cleanup = () => {};
afterEach(() => {
  mini?.cleanup();
  cleanup();
});

describe('every upstream file has a requirement record', () => {
  test('the real tree has a record for each locked file, and every behavioral span resolves', () => {
    const inputs = loadInputs(PKG);
    const { records, problems } = buildRecords(PKG, inputs);
    expect(problems).toEqual([]);
    const covered = new Set(records.flatMap((r) => (r.source?.file ? [r.source.file] : (r.source?.files?.map((f) => f.file) ?? []))));
    for (const path of Object.keys(inputs.lock.files)) expect(covered.has(path), path).toBe(true);
  });

  test('a new upstream file with no record fails the build', () => {
    mini = miniRoot({ extraFiles: { 'vendor/upstream-pstack/skills/x/new-file.md': 'new\n' } });
    mini.write(
      'requirements/requirements.json',
      JSON.stringify({
        ...JSON.parse(readFileSync(join(mini.root, 'requirements/requirements.json'), 'utf8')),
        structural: [{ id: 'only-skill-md', match: '^pstack:skills/x/SKILL\\.md$', kind: 'primary-skill', title: 'S', specSection: '4.1', observable: 'o', invariants: ['i'], piMechanism: 'm', tests: [], verification: 'v' }],
      }),
    );
    const { problems } = buildRecords(mini.root, loadInputs(mini.root));
    expect(problems).toContain('vendor/upstream-pstack/skills/x/new-file.md: upstream file has no requirement record; add a structural rule to requirements/requirements.json');
  });

  test('check-parity fails on the real package when upstream gains a file', () => {
    const f = fixture();
    cleanup = f.cleanup;
    cpSync(join(PKG, 'requirements'), join(f.root, 'requirements'), { recursive: true });
    const added = 'vendor/upstream-pstack/skills/how/surprise.md';
    writeFileSync(join(f.root, added), 'surprise\n');
    const lockPath = join(f.root, 'generated/upstream-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.files[added] = createHash('sha256').update('surprise\n').digest('hex');
    writeFileSync(lockPath, JSON.stringify(lock));
    const result = script('check-parity.mjs', ['--root', f.root]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${added}: upstream file has no requirement record`);
  });

  test('a rule that matches no upstream file is stale and fails the build', () => {
    mini = miniRoot();
    const path = join(mini.root, 'requirements/requirements.json');
    const requirements = JSON.parse(readFileSync(path, 'utf8'));
    requirements.structural.push({ ...requirements.structural[0], id: 'ghost', match: '^pstack:nothing/.+$' });
    writeFileSync(path, JSON.stringify(requirements));
    expect(buildRecords(mini.root, loadInputs(mini.root)).problems).toContain('structural rule ghost: matches no upstream file (stale rule)');
  });
});

describe('a source span cannot be fabricated', () => {
  const withSource = (source: object) => {
    mini = miniRoot({
      behavioral: [{ id: 'BEH-ONE', title: 'One', specSection: '12', source, observable: 'o', invariants: ['i'], piMechanism: 'm', dependencies: [], prerequisites: [], applicability: { mandatory: true }, verification: 'v', tests: [] }],
    });
    return buildRecords(mini.root, loadInputs(mini.root)).problems;
  };

  test('a span that resolves and contains its anchor is accepted', () => {
    expect(withSource({ file: SKILL, lines: [3, 4], anchor: 'Stop at the line' })).toEqual([]);
  });

  test('lines past the end of the file are rejected', () => {
    expect(withSource({ file: SKILL, lines: [3, 40], anchor: 'Stop' })).toEqual([expect.stringContaining('is past the end of the file (4 lines)')]);
  });

  test('an anchor that is not in the cited lines is rejected', () => {
    expect(withSource({ file: SKILL, lines: [1, 2], anchor: 'Stop at the line' })).toEqual([expect.stringContaining('anchor "Stop at the line" is not in')]);
  });

  test('a file that is not a locked upstream file is rejected', () => {
    expect(withSource({ file: 'vendor/upstream-pstack/skills/y/SKILL.md', lines: [1, 1], anchor: 'X' })).toEqual([expect.stringContaining('is not a locked upstream file')]);
  });

  test('a span with no anchor, reversed lines, or a spec-only source with no reason is rejected', () => {
    expect(withSource({ file: SKILL, lines: [3, 4] })).toEqual([expect.stringContaining('needs an anchor')]);
    expect(withSource({ file: SKILL, lines: [4, 3], anchor: 'Stop' })).toEqual([expect.stringContaining('must be [first, last]')]);
    expect(withSource({ specOnly: true })).toEqual([expect.stringContaining('needs a written reason')]);
  });

  test('check-parity fails when a committed requirement cites a fabricated span', () => {
    const f = fixture();
    cleanup = f.cleanup;
    cpSync(join(PKG, 'requirements'), join(f.root, 'requirements'), { recursive: true });
    const path = join(f.root, 'requirements/requirements.json');
    const requirements = JSON.parse(readFileSync(path, 'utf8'));
    requirements.behavioral[0].source.lines = [9000, 9001];
    writeFileSync(path, JSON.stringify(requirements));
    appendFileSync(path, '\n');
    const result = script('check-parity.mjs', ['--root', f.root]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('is past the end of the file');
  });
});
