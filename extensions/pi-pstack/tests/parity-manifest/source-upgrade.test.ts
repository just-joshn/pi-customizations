import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { PKG } from '../skill-parity/helpers.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-sync-'));
  dirs.push(dir);
  return dir;
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();

function writeUpstream(repo: string, skillText: string) {
  const files: Record<string, string> = {
    'pstack/skills/how/SKILL.md': skillText,
    'pstack/agents/a.md': 'agent',
    'pstack/automations/b.md': 'auto',
    'pstack/docs/d.md': 'doc',
    'pstack/assets/x.txt': 'asset',
    'pstack/.cursor-plugin/plugin.json': '{}',
    'pstack/plugin.json': '{"version":"1.0.0"}',
    'pstack/README.md': 'r',
    'pstack/LICENSE': 'l',
    'cursor-team-kit/skills/t/SKILL.md': 'team',
    'cursor-team-kit/.cursor-plugin/plugin.json': '{"version":"1.2.0"}',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
}

function scenario() {
  const upstream = tmp();
  git(upstream, 'init', '-q');
  writeUpstream(upstream, 'one');
  git(upstream, 'add', '-A');
  git(upstream, 'commit', '-qm', 'one');
  const first = git(upstream, 'rev-parse', 'HEAD');
  const pkg = tmp();
  cpSync(join(PKG, 'package.json'), join(pkg, 'package.json'));
  mkdirSync(join(pkg, 'generated'));
  const sync = (args: string[]) => spawnSync(process.execPath, [join(PKG, 'scripts/sync-upstream.mjs'), '--root', pkg, '--repository', upstream, ...args], { encoding: 'utf8' });
  const first1 = sync(['--revision', first]);
  expect(first1.status, first1.stderr).toBe(0);
  return { upstream, pkg, first, sync };
}

describe('source upgrade', () => {
  test('a pin move with no vendored content change goes through and is logged without a review', () => {
    const { upstream, pkg, first, sync } = scenario();
    writeFileSync(join(upstream, 'unrelated.txt'), 'x');
    git(upstream, 'add', '-A');
    git(upstream, 'commit', '-qm', 'two');
    const second = git(upstream, 'rev-parse', 'HEAD');
    const result = sync(['--revision', second]);
    expect(result.status, result.stderr).toBe(0);
    const { entries } = JSON.parse(readFileSync(join(pkg, 'generated/source-review-log.json'), 'utf8'));
    expect(entries.at(-1)).toMatchObject({ from: first, to: second, contentChanged: false });
    expect(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).pstackSource.revision).toBe(second);
  });

  test('sync records complete source blobs and preserves explicitly excluded pin files', () => {
    const { upstream, pkg, first, sync } = scenario();
    mkdirSync(join(pkg, 'scripts'));
    writeFileSync(join(pkg, 'scripts/start-run.mjs'), first);
    writeFileSync(join(upstream, 'cursor-team-kit/LICENSE'), 'license');
    git(upstream, 'add', '-A');
    git(upstream, 'commit', '-qm', 'add source metadata outside the vendor subset');
    const second = git(upstream, 'rev-parse', 'HEAD');
    const result = sync(['--revision', second, '--skip-pin-file', 'scripts/start-run.mjs']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(pkg, 'scripts/start-run.mjs'), 'utf8')).toBe(first);
    const inventory = JSON.parse(readFileSync(join(pkg, 'generated/upstream-inventory.json'), 'utf8'));
    expect(inventory.revision).toBe(second);
    expect(inventory.sources.map((source: { revision: string }) => source.revision)).toEqual([second, second]);
    expect(inventory.files['cursor-team-kit/LICENSE']).toMatchObject({ blob: git(upstream, 'rev-parse', `${second}:cursor-team-kit/LICENSE`), vendorPath: null });
    expect(inventory.files['pstack/skills/how/SKILL.md'].vendorPath).toBe('vendor/upstream-pstack/skills/how/SKILL.md');
    expect(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).teamKitSource.revision).toBe(second);
  });

  test('a changed upstream instruction is refused without a parity review and writes nothing', () => {
    const { upstream, pkg, first, sync } = scenario();
    writeUpstream(upstream, 'two');
    git(upstream, 'commit', '-qam', 'change an instruction');
    const second = git(upstream, 'rev-parse', 'HEAD');
    const result = sync(['--revision', second]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Review each against the parity manifest');
    expect(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).pstackSource.revision).toBe(first);
    expect(readFileSync(join(pkg, 'vendor/upstream-pstack/skills/how/SKILL.md'), 'utf8')).toBe('one');
  });

  test('a review record that does not name the changed files is refused; a matching one is logged', () => {
    const { upstream, pkg, first, sync } = scenario();
    writeUpstream(upstream, 'two');
    git(upstream, 'commit', '-qam', 'change an instruction');
    const second = git(upstream, 'rev-parse', 'HEAD');
    const review = join(tmp(), 'review.json');
    writeFileSync(review, JSON.stringify({ from: first, to: second, reviewer: 'r', notes: 'n', changedFiles: [] }));
    expect(sync(['--revision', second, '--review', review]).status).not.toBe(0);
    writeFileSync(review, JSON.stringify({ from: first, to: second, reviewer: 'r', notes: 'checked how', changedFiles: ['vendor/upstream-pstack/skills/how/SKILL.md'] }));
    const ok = sync(['--revision', second, '--review', review]);
    expect(ok.status, ok.stderr).toBe(0);
    const { entries } = JSON.parse(readFileSync(join(pkg, 'generated/source-review-log.json'), 'utf8'));
    expect(entries.at(-1)).toMatchObject({ contentChanged: true, review: { reviewer: 'r' } });
  });
});

describe('fetched source verification', () => {
  test('verifies the fetched tree and rejects modified working bytes', () => {
    const { upstream, pkg } = scenario();
    const verify = () => spawnSync(process.execPath, [join(PKG, 'scripts/verify-source-inventory.mjs'), '--root', pkg, '--checkout', upstream], { encoding: 'utf8' });
    expect(verify().status).toBe(0);
    writeFileSync(join(upstream, 'pstack/skills/how/SKILL.md'), 'changed');
    const result = verify();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('fetched bytes or recorded hash differ');
  });

  test('rejects a different checkout revision even when all source bytes are identical', () => {
    const { upstream, pkg } = scenario();
    git(upstream, 'commit', '--allow-empty', '-qm', 'different revision, identical source');
    const result = spawnSync(process.execPath, [join(PKG, 'scripts/verify-source-inventory.mjs'), '--root', pkg, '--checkout', upstream], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('revisions must match exactly');
  });
});

describe('pin consistency gate', () => {
  test('the audited ZIP revision is required even when another revision has identical files and a sync log', async () => {
    const { fixture } = await import('../skill-parity/helpers.ts');
    const f = fixture();
    try {
      const revision = '1'.repeat(40);
      for (const [path, key] of [
        ['generated/upstream-lock.json', 'revision'],
        ['package.json', 'pstackSource'],
      ] as const) {
        const value = JSON.parse(readFileSync(join(f.root, path), 'utf8'));
        if (key === 'revision') value.revision = revision;
        else value.pstackSource.revision = revision;
        writeFileSync(join(f.root, path), JSON.stringify(value));
      }
      writeFileSync(join(f.root, 'generated/source-review-log.json'), JSON.stringify({ entries: [{ from: revision, to: revision, contentChanged: false, changedFiles: [], review: null }] }));
      const result = spawnSync(process.execPath, [join(PKG, 'scripts/check-parity.mjs'), '--root', f.root], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('does not match the audited ZIP revision 3dbd22ff12742fb28c9700b9760baa29ed41dc13');
    } finally {
      f.cleanup();
    }
  });

  test('check-parity fails when the lock moves without a source-review-log entry', async () => {
    const { fixture } = await import('../skill-parity/helpers.ts');
    const f = fixture();
    try {
      const lockPath = join(f.root, 'generated/upstream-lock.json');
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      lock.revision = '0'.repeat(40);
      writeFileSync(lockPath, JSON.stringify(lock));
      const result = spawnSync(process.execPath, [join(PKG, 'scripts/check-parity.mjs'), '--root', f.root], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('differs from generated/upstream-lock.json');
      expect(result.stderr).toContain('the pin moved without scripts/sync-upstream.mjs');
    } finally {
      f.cleanup();
    }
  });
});
