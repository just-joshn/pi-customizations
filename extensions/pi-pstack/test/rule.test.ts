import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cursorRuleWriteReason, modelsSection } from '../src/rule.ts';
import { makeSandbox, runJson, type Sandbox, script, toolEnds } from './e2e/harness.ts';

const home = '/home/u';
const piRule = '/home/u/.pi/agent/pstack/pstack-models.mdc';

describe('Cursor rule guard (RULE-002)', () => {
  test.for([
    { toolName: 'write', path: '~/.cursor/rules/pstack-models.mdc', cwd: '/w' },
    { toolName: 'edit', path: '/home/u/.cursor/rules/pstack-models.mdc', cwd: '/w' },
    { toolName: 'write', path: '../.cursor/rules/pstack-models.mdc', cwd: '/home/u/project' },
    { toolName: 'write', path: '/home/u/.cursor/rules/../rules/pstack-models.mdc', cwd: '/w' },
  ])('blocks $toolName on $path', ({ toolName, path, cwd }) => {
    expect(cursorRuleWriteReason(toolName, { path }, { cwd, home, piRulePath: piRule })).toBe(`pstack's model rule lives at ${piRule} in Pi. Write that file instead; ~/.cursor/rules/pstack-models.mdc belongs to Cursor.`);
  });

  test('allows every other target and tool', () => {
    const calls = [
      { toolName: 'write', path: piRule },
      { toolName: 'read', path: '~/.cursor/rules/pstack-models.mdc' },
      { toolName: 'write', path: '~/.cursor/rules/other.mdc' },
      { toolName: 'write', path: 42 },
      { toolName: 'edit', path: '~/.cursor/rules/pstack-models.mdc' },
    ];
    const reasons = calls.map(({ toolName, path }) => cursorRuleWriteReason(toolName, { path }, { cwd: '/w', home, piRulePath: piRule }));
    expect(reasons.map((reason) => (reason === undefined ? 'allowed' : 'blocked'))).toEqual(['allowed', 'allowed', 'allowed', 'allowed', 'blocked']);
  });
});

describe('guard against the paths Pi write and edit resolve (RULE-002; review: security 1)', () => {
  let home = '';
  let piRulePath = '';
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'guard-home-')));
    mkdirSync(join(home, '.cursor/rules'), { recursive: true });
    writeFileSync(join(home, '.cursor/rules/pstack-models.mdc'), 'cursor rule');
    mkdirSync(join(home, 'work'));
    symlinkSync(join(home, '.cursor/rules/pstack-models.mdc'), join(home, 'work/link.mdc'));
    piRulePath = join(home, '.pi/agent/pstack/pstack-models.mdc');
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  test('blocks @-prefixed, file:// URL, symlinked, and case-variant spellings of the Cursor rule', () => {
    const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';
    const spellings = [
      '@~/.cursor/rules/pstack-models.mdc',
      pathToFileURL(join(home, '.cursor/rules/pstack-models.mdc')).href,
      'link.mdc',
      '~/.cursor/rules/Pstack-Models.mdc',
      '~/.CURSOR/rules/pstack-models.mdc',
      '~/.cursor/rules/pstack\u00a0models.mdc',
    ];
    const verdicts = spellings.map((path) => (cursorRuleWriteReason('edit', { path }, { cwd: join(home, 'work'), home, piRulePath }) === undefined ? 'allowed' : 'blocked'));
    expect(verdicts).toEqual(['blocked', 'blocked', 'blocked', caseInsensitive ? 'blocked' : 'allowed', caseInsensitive ? 'blocked' : 'allowed', 'allowed']);
  });
});

describe('guard when the rule folder does not exist yet (review r2: security)', () => {
  let home = '';
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'guard-link-')));
    mkdirSync(join(home, 'real-cursor'));
    symlinkSync(join(home, 'real-cursor'), join(home, '.cursor'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  test('blocks the real target behind a symlinked ~/.cursor before rules/ exists', () => {
    const verdicts = ['~/.cursor/rules/pstack-models.mdc', join(home, 'real-cursor/rules/pstack-models.mdc')].map((path) =>
      cursorRuleWriteReason('write', { path }, { cwd: home, home, piRulePath: join(home, '.pi/agent/pstack/pstack-models.mdc') }) === undefined ? 'allowed' : 'blocked',
    );
    expect(verdicts).toEqual(['blocked', 'blocked']);
  });
});

describe('models section (RULE-001)', () => {
  test('carries the rule body without its frontmatter', () => {
    const text = '---\ndescription: pstack per-role model choices\nalwaysApply: true\n---\n# budget: large (xhigh)\narena runners: claude-opus-5-5-xhigh, grok-4.7-xhigh-fast\n';
    expect(modelsSection(text, piRule)).toBe(`Path: ${piRule}\n# budget: large (xhigh)\narena runners: claude-opus-5-5-xhigh, grok-4.7-xhigh-fast`);
  });

  test('treats alwaysApply: false with a description as a rule the agent applies when relevant', () => {
    const text = '---\ndescription: pstack per-role model choices\nalwaysApply: false\n---\narena runners: grok-4.7-xhigh-fast\n';
    expect(modelsSection(text, piRule)).toBe(
      `The rule at ${piRule} is not always applied (alwaysApply: false). Its description: pstack per-role model choices. Read it when that description applies. Until then every role uses its skill default.`,
    );
  });

  test('treats alwaysApply: false without a description as a manual rule', () => {
    const text = '---\nalwaysApply: false\n---\narena runners: grok-4.7-xhigh-fast\n';
    expect(modelsSection(text, piRule)).toBe(`The rule at ${piRule} applies only when the user attaches it (alwaysApply: false, no description). Every role uses its skill default.`);
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

describe('guard through Pi (RULE-002)', () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = makeSandbox();
  });
  afterEach(() => sandbox.dispose());

  test('a scripted write to Cursor rule is blocked and the file is never created', async () => {
    const run = await runJson(sandbox, script([{ tool: 'write', args: { path: '~/.cursor/rules/pstack-models.mdc', content: 'clobbered' } }]), ['--no-session']);
    const [result] = toolEnds(run.events, 'write');
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain(`pstack's model rule lives at ${join(sandbox.agentDir, 'pstack/pstack-models.mdc')} in Pi.`);
    expect(existsSync(join(sandbox.root, '.cursor/rules/pstack-models.mdc'))).toBe(false);
  });
});
