import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { migrateLegacyRule, modelsSection } from '../src/rule.ts';

const piRule = '/home/u/.pi/agent/pstack/pstack-models.md';

describe('models section (RULE-001)', () => {
  test('carries the rule body', () => {
    const text = '# budget: large (xhigh)\narena runners: claude-opus-5-5:xhigh, grok-4.7:xhigh\n';
    expect(modelsSection(text, piRule)).toBe(`Path: ${piRule}\n# budget: large (xhigh)\narena runners: claude-opus-5-5:xhigh, grok-4.7:xhigh`);
  });

  test('drops a stray frontmatter block', () => {
    const text = '---\ndescription: old\n---\n# budget: small (medium)\n';
    expect(modelsSection(text, piRule)).toBe(`Path: ${piRule}\n# budget: small (medium)`);
  });

  test('says defaults apply when the rule is absent', () => {
    expect(modelsSection(undefined, piRule)).toBe(`No pstack model rule exists at ${piRule}. Every role uses its skill default until /setup-pstack writes one.`);
  });

  test('truncates an oversized rule and says so', () => {
    const section = modelsSection(`${'x'.repeat(20_000)}`, piRule);
    expect(section.length).toBeLessThan(8_300);
    expect(section.endsWith(`[truncated: the rule is 20000 characters; read ${piRule} for the rest]`)).toBe(true);
  });
});

describe('legacy rule migration (RULE-003)', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pstack-rule-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('moves the body of pstack-models.mdc to pstack-models.md once and keeps the old file aside', () => {
    writeFileSync(join(dir, 'pstack-models.mdc'), '---\ndescription: x\nalwaysApply: true\n---\n# budget: large (xhigh)\nbug-fix: grok-4.7:xhigh\n');
    const path = join(dir, 'pstack-models.md');
    migrateLegacyRule(path);
    expect(readFileSync(path, 'utf8')).toBe('# budget: large (xhigh)\nbug-fix: grok-4.7:xhigh\n');
    expect(existsSync(join(dir, 'pstack-models.mdc'))).toBe(false);
    expect(existsSync(join(dir, 'pstack-models.mdc.migrated'))).toBe(true);
  });

  test('never overwrites an existing rule', () => {
    writeFileSync(join(dir, 'pstack-models.mdc'), 'old\n');
    writeFileSync(join(dir, 'pstack-models.md'), 'new\n');
    migrateLegacyRule(join(dir, 'pstack-models.md'));
    expect(readFileSync(join(dir, 'pstack-models.md'), 'utf8')).toBe('new\n');
    expect(existsSync(join(dir, 'pstack-models.mdc'))).toBe(true);
  });

  test('does not overwrite an existing .migrated file', () => {
    writeFileSync(join(dir, 'pstack-models.mdc'), '---\ndescription: x\n---\n# budget: large\n');
    writeFileSync(join(dir, 'pstack-models.mdc.migrated'), 'keep-me\n');
    migrateLegacyRule(join(dir, 'pstack-models.md'));
    expect(readFileSync(join(dir, 'pstack-models.mdc.migrated'), 'utf8')).toBe('keep-me\n');
    expect(readFileSync(join(dir, 'pstack-models.md'), 'utf8')).toBe('# budget: large\n');
    expect(existsSync(join(dir, 'pstack-models.mdc'))).toBe(true);
  });

  test('two processes migrate once without throwing', async () => {
    writeFileSync(join(dir, 'pstack-models.mdc'), '---\ndescription: x\n---\n# budget: large\n');
    const source = pathToFileURL(join(import.meta.dirname, '../src/rule.ts')).href;
    const runner = join(dir, 'migrate.mts');
    const path = join(dir, 'pstack-models.md');
    writeFileSync(runner, `import { migrateLegacyRule } from ${JSON.stringify(source)};\nmigrateLegacyRule(${JSON.stringify(path)});\n`);
    const codes = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise<number>((resolve, reject) => {
            const child = spawn(process.execPath, ['--experimental-strip-types', runner], { stdio: ['ignore', 'ignore', 'pipe'] });
            let err = '';
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk: string) => (err += chunk));
            child.on('error', reject);
            child.on('close', (code) => (code === 0 ? resolve(0) : reject(new Error(err || `exit ${code}`))));
          }),
      ),
    );
    expect(codes).toEqual(Array.from({ length: 8 }, () => 0));
    expect(readFileSync(path, 'utf8')).toBe('# budget: large\n');
    expect(existsSync(join(dir, 'pstack-models.mdc'))).toBe(false);
    expect(existsSync(join(dir, 'pstack-models.mdc.migrated'))).toBe(true);
  });
});
