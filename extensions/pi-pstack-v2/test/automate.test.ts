import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkills } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AutomationManifestSchema, validateAutomation } from '../src/automate.ts';
import { list } from '../src/jobs.ts';
import { createWorld, type Host, loadPstack, type World } from './core-host.ts';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
let world: World;
let host: Host;

beforeEach(() => {
  world = createWorld();
  host = loadPstack(world);
});

afterEach(() => {
  world.dispose();
});

describe('automate command fail-closed lifecycle', () => {
  test('create drafts a disabled manifest with Benny skill paths for benny-triage and benny-reproduce, and refuses to overwrite', async () => {
    await host.command('automate').handler('create benny-triage', host.ctx());
    const triageFile = join(world.cwd, '.pi', 'automations', 'benny-triage.json');
    expect(existsSync(triageFile)).toBe(true);
    expect(AutomationManifestSchema.parse(JSON.parse(readFileSync(triageFile, 'utf8')))).toMatchObject({
      name: 'benny-triage',
      enabled: false,
      draftPrOnly: true,
      skillPath: '.pi/automations/benny/skills/triage-issue-reports/SKILL.md',
    });

    await host.command('automate').handler('create benny-reproduce', host.ctx());
    const reproFile = join(world.cwd, '.pi', 'automations', 'benny-reproduce.json');
    expect(AutomationManifestSchema.parse(JSON.parse(readFileSync(reproFile, 'utf8')))).toMatchObject({
      name: 'benny-reproduce',
      enabled: false,
      draftPrOnly: true,
      skillPath: '.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md',
    });

    await host.command('automate').handler('create benny-triage', host.ctx());
    expect(host.notify).toHaveBeenLastCalledWith(expect.stringContaining('already exists'), 'error');
  });
});

describe('automate run and stop lifecycle', () => {
  test('run fails closed when disabled or missing skillPath, and starts a watcher when valid and enabled', async () => {
    await host.command('automate').handler('create nightly-check', host.ctx());
    await host.command('automate').handler('run nightly-check', host.ctx());
    expect(host.notify).toHaveBeenLastCalledWith(expect.stringContaining('Fail-closed'), 'error');

    const skillDir = join(world.cwd, '.pi', 'automations', 'nightly-check');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: nightly-check\ndescription: check\n---\n');
    const manifestFile = join(world.cwd, '.pi', 'automations', 'nightly-check.json');
    const parsed = AutomationManifestSchema.parse(JSON.parse(readFileSync(manifestFile, 'utf8')));
    const updated = { ...parsed, enabled: true, triggerCommand: 'echo TRIGGER:ok; sleep 5' };
    writeFileSync(manifestFile, JSON.stringify(updated));

    expect(validateAutomation(world.cwd, 'nightly-check').ok).toBe(true);
    await host.command('automate').handler('run nightly-check', host.ctx());
    expect(host.notify).toHaveBeenLastCalledWith(expect.stringContaining('Started automation "nightly-check"'), 'info');
    const running = list(world.jobsRoot, host.sessionId).filter((job) => job.spec.name === 'automate-nightly-check' && job.status.state === 'running');
    expect(running).toHaveLength(1);
    expect(running[0]?.spec.notifyOnOutput?.reason).toContain('DRAFT PR only');

    await host.command('automate').handler('run nightly-check', host.ctx());
    expect(host.notify).toHaveBeenLastCalledWith(expect.stringContaining('already running'), 'info');
    expect(list(world.jobsRoot, host.sessionId).filter((job) => job.spec.name === 'automate-nightly-check' && job.status.state === 'running')).toHaveLength(1);

    await host.command('automate').handler('stop nightly-check', host.ctx());
    expect(host.notify).toHaveBeenLastCalledWith(expect.stringContaining('Stopped 1 running job(s)'), 'info');
    expect(list(world.jobsRoot, host.sessionId).filter((job) => job.spec.name === 'automate-nightly-check' && job.status.state === 'running')).toEqual([]);
  });
});

describe('automate explicit skillPath', () => {
  test('create accepts an optional explicit skillPath argument', async () => {
    await host.command('automate').handler('create custom-bot .pi/custom/SKILL.md', host.ctx());
    const manifestFile = join(world.cwd, '.pi', 'automations', 'custom-bot.json');
    expect(AutomationManifestSchema.parse(JSON.parse(readFileSync(manifestFile, 'utf8')))).toMatchObject({
      name: 'custom-bot',
      skillPath: '.pi/custom/SKILL.md',
    });
  });
});

describe('automate validation errors', () => {
  test('status and run fail closed with an error notification instead of throwing on invalid regex patterns', async () => {
    const dir = join(world.cwd, '.pi', 'automations');
    mkdirSync(join(dir, 'bad-pat'), { recursive: true });
    writeFileSync(join(dir, 'bad-pat', 'SKILL.md'), '---\nname: bad-pat\ndescription: x\n---\n');
    writeFileSync(join(dir, 'bad-pat.json'), JSON.stringify({ name: 'wrong-name', description: 'd', enabled: true, skillPath: '.pi/automations/bad-pat/SKILL.md', triggerCommand: 'true', pattern: '^OK', reason: 'r' }));
    const mismatch = validateAutomation(world.cwd, 'bad-pat');
    expect(mismatch.ok).toBe(false);
    expect(mismatch.errors.some((e) => e.includes('does not match'))).toBe(true);

    writeFileSync(join(dir, 'bad-pat.json'), JSON.stringify({ name: 'bad-pat', description: 'd', enabled: true, skillPath: '.pi/automations/bad-pat/SKILL.md', triggerCommand: 'true', pattern: '[unclosed', reason: 'r' }));
    const invalid = validateAutomation(world.cwd, 'bad-pat');
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.some((e) => e.includes('not a valid regular expression'))).toBe(true);

    await host.command('automate').handler('status bad-pat', host.ctx());
    expect(host.notify).toHaveBeenLastCalledWith(expect.stringContaining('not a valid regular expression'), 'error');

    await host.command('automate').handler('run bad-pat', host.ctx());
    expect(host.notify).toHaveBeenLastCalledWith(expect.stringContaining('not a valid regular expression'), 'error');
  });
});

describe('Benny dormant automation pack', () => {
  test('ships all 5 Benny files under automations/benny/ without registering them as slash skills', () => {
    const bennyFiles = [
      'automations/benny/FOR_AGENTS.md',
      'automations/benny/skills/setup-benny/SKILL.md',
      'automations/benny/skills/triage-issue-reports/SKILL.md',
      'automations/benny/skills/reproduce-and-fix-issues/SKILL.md',
      'automations/benny/skills/reproduce-and-fix-issues/references/verify-existing-fix.md',
    ];
    for (const rel of bennyFiles) expect(existsSync(join(packageRoot, rel))).toBe(true);

    const loaded = loadSkills({ cwd: packageRoot, agentDir: world.agentDir, skillPaths: [join(packageRoot, 'skills')], includeDefaults: false });
    const names = new Set(loaded.skills.map((skill) => skill.name));
    expect(names.has('setup-benny')).toBe(false);
    expect(names.has('triage-issue-reports')).toBe(false);
    expect(names.has('reproduce-and-fix-issues')).toBe(false);
  });
});
