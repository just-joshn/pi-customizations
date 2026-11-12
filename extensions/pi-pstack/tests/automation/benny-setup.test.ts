import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

const script = resolve(import.meta.dirname, '../../scripts/benny-setup.mjs');
let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'benny-setup-test-'));
});

afterEach(() => rmSync(project, { recursive: true, force: true }));

const run = () => JSON.parse(execFileSync(process.execPath, [script, '--project', project, '--credentials', join(project, 'absent.json')], { encoding: 'utf8' }));

test('setup preserves existing local config and pack edits and reports them as conflicts', () => {
  const config = join(project, '.pi', 'benny', 'configuration.yaml');
  const packFile = join(project, '.pi', 'automations', 'benny', 'skills', 'setup-benny', 'SKILL.md');
  const localOnly = join(project, '.pi', 'automations', 'benny', 'local-notes.md');
  mkdirSync(join(project, '.pi', 'benny'), { recursive: true });
  mkdirSync(join(project, '.pi', 'automations', 'benny', 'skills', 'setup-benny'), { recursive: true });
  writeFileSync(config, 'slack:\n  source_channel_id: "CMINE"\n');
  writeFileSync(packFile, 'my local edit\n');
  writeFileSync(localOnly, 'keep me\n');

  const report = run();

  expect(readFileSync(config, 'utf8')).toBe('slack:\n  source_channel_id: "CMINE"\n');
  expect(readFileSync(packFile, 'utf8')).toBe('my local edit\n');
  expect(readFileSync(localOnly, 'utf8')).toBe('keep me\n');
  expect(report.localConfig.conflicts).toEqual(['.pi/benny/configuration.yaml']);
  expect(report.localConfig.added).toEqual(['.pi/benny/feature-map.md', '.pi/benny/routing.md']);
  expect(report.pack.conflicts).toEqual(['skills/setup-benny/SKILL.md']);
  expect(report.pack.added).toContain('FOR_AGENTS.md');
  expect(report.sameUidLimit).toMatch(/uid/);
  expect(report.connector).toEqual({ webhookSecret: 'present, 0600' });
  expect(report.testEvent).toEqual({ ok: true, spawns: 1, replies: 1 });
});

test('a second setup run changes nothing and reports every file unchanged', () => {
  run();
  const report = run();
  expect(report.pack.added).toEqual([]);
  expect(report.pack.conflicts).toEqual([]);
  expect(report.localConfig).toEqual({ added: [], unchanged: ['.pi/benny/configuration.yaml', '.pi/benny/feature-map.md', '.pi/benny/routing.md'], conflicts: [] });
});
