import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { buildRuleSection, installRuleWizard, slugifyName, wizardResultMessage } from '../src/wizard/rule.ts';

describe('rule wizard formatting', () => {
  it('slugifies the first four words like the the reference CLI prefill', () => {
    expect(slugifyName('Always use TypeScript strict mode everywhere')).toBe('always-use-typescript-strict');
    expect(slugifyName('!!')).toBe('rule');
  });

  it('builds a rule section for AGENTS.md', () => {
    const section = buildRuleSection('Always use TypeScript strict mode.');
    expect(section.includes('## Rule: Always use TypeScript strict mode')).toBe(true);
    expect(section.includes('Always use TypeScript strict mode.')).toBe(true);
  });

  it('formats the the reference CLI result states', () => {
    expect(wizardResultMessage({ status: 'created', path: '/p/AGENTS.md', message: '' })).toBe('✓ Rule created! /p/AGENTS.md Edit the file to customize guidelines and examples.');
    expect(wizardResultMessage({ status: 'exists', path: '/p/AGENTS.md', message: '' })).toBe('⚠️ Rule already exists: /p/AGENTS.md');
    expect(wizardResultMessage({ status: 'cancelled', path: '', message: '' })).toBe('Cancelled.');
  });
});

type RuleHandler = (args: string, ctx: unknown) => Promise<void>;

function registerRule(): Map<string, { handler: RuleHandler }> {
  const registered = new Map<string, { handler: RuleHandler }>();
  installRuleWizard({ registerCommand: (id: string, def: { handler: RuleHandler }) => registered.set(id, def) } as never);
  return registered;
}

function ruleHandler(): RuleHandler {
  const handler = registerRule().get('rule')?.handler;
  if (!handler) throw new Error('rule command not registered');
  return handler;
}

function makeRuleDir(): string {
  const dirPath = mkdtempSync(`${tmpdir()}/rule-wizard-test-`);
  onTestFinished(() => rmSync(dirPath, { recursive: true, force: true }));
  vi.stubEnv('HOME', dirPath);
  return dirPath;
}

function dialogContext(cwd: string) {
  const calls: string[] = [];
  const ctx = {
    cwd,
    ui: {
      input: async (title: string, placeholder?: string) => {
        calls.push(`input:${title}:${placeholder ?? ''}`);
        return 'Always use consistent indentation.';
      },
      select: async (title: string, options: string[]) => {
        calls.push(`select:${title}:${options.length}`);
        return options[0];
      },
      notify: (message: string, type: string) => {
        calls.push(`notify:${type}:${message}`);
      },
    },
  };
  return { ctx, calls };
}

const writtenSection = '\n## Rule: Always use consistent indentation\n\nAlways use consistent indentation.\n';

describe('rule wizard command', () => {
  it('registers /rule', () => {
    expect(registerRule().has('rule')).toBe(true);
  });

  it('drives the wizard through pi dialogs and writes AGENTS.md', async () => {
    const dirPath = makeRuleDir();
    const target = `${dirPath}/AGENTS.md`;
    const { ctx, calls } = dialogContext(dirPath);
    await ruleHandler()('', ctx);
    expect(calls[0]).toBe('input:What should this rule instruct the AI to do?:e.g., Always use TypeScript strict mode');
    expect(calls[1]).toBe('select:Where should this rule be saved?:2');
    expect(calls.at(-1)).toBe(`notify:info:✓ Rule created! ${target} Edit the file to customize guidelines and examples.`);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(writtenSection);
  });

  it('warns and leaves AGENTS.md untouched when the rule already exists', async () => {
    const dirPath = makeRuleDir();
    const target = `${dirPath}/AGENTS.md`;
    const { ctx, calls } = dialogContext(dirPath);
    const handler = ruleHandler();
    await handler('', ctx);
    await handler('', ctx);
    expect(calls.at(-1)).toBe(`notify:warning:⚠️ Rule already exists: ${target}`);
    expect(readFileSync(target, 'utf8')).toBe(writtenSection);
  });

  it('cancels the wizard when the description or the scope is missing', async () => {
    const handler = ruleHandler();
    const notify = vi.fn();
    const projectScope = 'Project Rule — Applies to this repository only';
    await handler('', { cwd: '/nonexistent', ui: { input: async () => '', select: async () => projectScope, notify } });
    expect(notify).toHaveBeenCalledWith('Cancelled.', 'info');
    await handler('', { cwd: '/nonexistent', ui: { input: async () => 'Some rule', select: async () => undefined, notify } });
    expect(notify).toHaveBeenCalledWith('Cancelled.', 'info');
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
