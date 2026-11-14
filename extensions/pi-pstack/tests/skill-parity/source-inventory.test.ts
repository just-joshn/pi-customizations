import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { listFiles, sha256, UPSTREAM } from '../../adapters/provenance.ts';
import { PKG } from './helpers.ts';

const revision = '3dbd22ff12742fb28c9700b9760baa29ed41dc13';
const read = (path: string) => JSON.parse(readFileSync(join(PKG, path), 'utf8'));

describe('audited ZIP source inventory', () => {
  test('both source roots and every vendored byte match the fetched pinned inventory', () => {
    const inventory = read('generated/upstream-inventory.json');
    const lock = read('generated/upstream-lock.json');
    expect(UPSTREAM.revision).toBe(revision);
    expect(inventory.revision).toBe(revision);
    expect(lock.revision).toBe(revision);
    expect(read('package.json').pstackSource.revision).toBe(revision);
    expect(read('package.json').teamKitSource).toMatchObject({ revision, version: '1.2.0' });
    expect(sha256(readFileSync(join(PKG, 'licenses/cursor-team-kit.LICENSE')))).toBe(inventory.files['cursor-team-kit/LICENSE'].sha256);
    expect(inventory.sources.map((source: { revision: string }) => source.revision)).toEqual([revision, revision]);
    expect(inventory.sources.map((source: { files: number }) => source.files)).toEqual([573, 29]);
    expect(Object.keys(inventory.files)).toHaveLength(602);
    const vendored: string[] = [];
    for (const entry of Object.values(inventory.files) as { blob: string; sha256: string; vendorPath: string | null }[]) {
      if (!entry.vendorPath) continue;
      const bytes = readFileSync(join(PKG, entry.vendorPath));
      expect(sha256(bytes), entry.vendorPath).toBe(entry.sha256);
      expect(lock.files[entry.vendorPath], entry.vendorPath).toBe(entry.sha256);
      expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), entry.vendorPath).toBe(entry.blob);
      vendored.push(entry.vendorPath);
    }
    expect(vendored.sort()).toEqual(
      listFiles(join(PKG, 'vendor'))
        .map((path) => `vendor/${path}`)
        .sort(),
    );
    expect(vendored.sort()).toEqual(Object.keys(lock.files).sort());
    expect(vendored).toHaveLength(593);
  });

  test('the pinned inventory includes the complete guide, playbooks, principles and dormant skills', () => {
    const paths = Object.keys(read('generated/upstream-inventory.json').files);
    expect(paths.filter((path) => /^pstack\/docs\/guide\/[^/]+\.md$/.test(path))).toHaveLength(11);
    expect(paths.filter((path) => /^pstack\/skills\/poteto-mode\/playbooks\/[^/]+\.md$/.test(path))).toHaveLength(23);
    expect(paths.filter((path) => /^pstack\/skills\/principle-[^/]+\/SKILL\.md$/.test(path))).toHaveLength(24);
    expect(paths.filter((path) => /^pstack\/skills\/(?!principle-)[^/]+\/SKILL\.md$/.test(path))).toHaveLength(34);
    expect(paths.filter((path) => /^pstack\/automations\/benny\/skills\/[^/]+\/SKILL\.md$/.test(path))).toHaveLength(3);
    expect(paths.filter((path) => /^cursor-team-kit\/skills\/[^/]+\/SKILL\.md$/.test(path))).toHaveLength(18);
    expect(paths.filter((path) => /^cursor-team-kit\/agents\/[^/]+\.md$/.test(path))).toHaveLength(2);
    expect(paths.filter((path) => /^cursor-team-kit\/rules\/[^/]+\.mdc$/.test(path))).toHaveLength(2);
  });
});
