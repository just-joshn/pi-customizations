import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';
import { deliverVerdict } from '../scripts/benny-runtime.mjs';
import { bennyCommitted, bennyDependencies, installBenny, nativeBennyFiles } from '../scripts/benny-setup.mjs';
import { fixDecision, freezeSource, trustedVerdict } from '../src/benny-domain.ts';

const run = promisify(execFile);
const config = { sourceChannel: 'C-report', triageIdentity: 'U-triage' };
const trigger = { source_channel_id: 'C-report', message_ts: '100.000001' };
const source = { channel: 'C-report', thread: '100.000001' };
const issue = { title: 'Known new bug', eligibility: { classification: 'bug' as const, clearlyBroken: true, stillLive: true, duplicate: 'none' as const, targetResolved: true, permalink: 'https://slack.test/report' } };

test('the dormant native pack preserves source algorithms and replaces host setup mechanics', async () => {
  const files = await nativeBennyFiles();
  expect(files['skills/triage-issue-reports/SKILL.md']).toContain('Verify that the issue is canceled, closed, or deleted.');
  expect(files['skills/reproduce-and-fix-issues/SKILL.md']).toContain('The exact discriminating symptom must appear twice through real UI interaction.');
  expect(files['skills/setup-benny/SKILL.md']).toContain('RoutinePrepare');
  expect(files['skills/setup-benny/SKILL.md']).toContain('RoutineEnable');
  expect(files['templates/triage-automation-prompt.md']).toContain('.pi/automations/benny/skills/triage-issue-reports/SKILL.md');
  expect(Object.values(files).join('\n')).not.toContain('.cursor/');
});

test('installation is inert, installs project dependencies, and refuses to overwrite edited pack files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-benny-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const first = await installBenny(root);
  expect(first).toMatchObject({ enabled: false, conflicts: [] });
  expect(await readFile(join(root, '.pi/skills/how/SKILL.md'), 'utf8')).toContain('name: how');
  const operational = join(root, '.pi/automations/benny/skills/triage-issue-reports/SKILL.md');
  await writeFile(operational, 'local operator edit');
  await writeFile(join(root, '.pi/automations/benny/notes.txt'), 'keep');
  const refresh = await installBenny(root);
  expect(refresh.conflicts).toContain('.pi/automations/benny/skills/triage-issue-reports/SKILL.md');
  expect(await readFile(operational, 'utf8')).toBe('local operator edit');
  expect(await readFile(join(root, '.pi/automations/benny/notes.txt'), 'utf8')).toBe('keep');
});

test('source coordinates stay immutable and a reply cannot replace the original parent', () => {
  const result = freezeSource(config, { ...trigger, thread_ts: '90.000001' });
  expect(result).toEqual({ channel: 'C-report', thread: '90.000001' });
  expect(Object.isFrozen(result)).toBe(true);
  expect(() => freezeSource(config, { ...trigger, source_channel_id: 'C-other' })).toThrow('source channel');
  expect(() => freezeSource(config, { source_channel_id: 'C-report' })).toThrow('timestamp');
});

test.for([
  { user: 'U-untrusted', channel: 'C-report', thread_ts: '100.000001', text: '[benny:bug]' },
  { user: 'U-triage', channel: 'C-report', thread_ts: 'other', text: '[benny:bug]' },
  { user: 'U-triage', channel: 'C-report', thread_ts: '100.000001', text: '[benny:bug] [benny:performance]' },
  { user: 'U-triage', channel: 'C-report', thread_ts: '100.000001', text: '[benny:other]' },
])('untrusted or non-actionable verdicts cannot start repro %j', (message) => {
  expect(trustedVerdict(config, source, message)).toBeUndefined();
});

test('a trusted marker in the original thread permits repro', () => {
  expect(trustedVerdict(config, source, { user: 'U-triage', channel: 'C-report', thread_ts: '100.000001', text: 'Confirmed.\n[benny:bug] tracker=https://tracker.test/1' })).toEqual({ kind: 'bug', tracker: 'https://tracker.test/1' });
});

test('a failed verdict compensates only the issue created by this run', async () => {
  const actions: string[] = [];
  const adapter = {
    parent: async () => ({ ...source, exists: true }),
    createIssue: async () => {
      actions.push('create');
      return 'issue-1';
    },
    reply: async (coordinates: typeof source) => {
      expect(coordinates).toEqual(source);
      actions.push('reply');
      return 'reply-1';
    },
    verifyReply: async () => false,
    compensate: async (id: string) => {
      actions.push(`cancel:${id}`);
    },
    verifyCompensation: async () => true,
  };
  await expect(deliverVerdict(source, adapter, '[benny:bug]', issue)).rejects.toThrow('compensated');
  expect(actions).toEqual(['create', 'reply', 'cancel:issue-1']);
});

test('a missing parent causes no Slack or tracker writes', async () => {
  const actions: string[] = [];
  const adapter = {
    parent: async () => ({ ...source, exists: false }),
    createIssue: async () => {
      actions.push('create');
      return 'bad';
    },
    reply: async () => {
      actions.push('reply');
      return 'bad';
    },
    verifyReply: async () => true,
    compensate: async () => {},
    verifyCompensation: async () => true,
  };
  await expect(deliverVerdict(source, adapter, '[benny:bug]', issue)).rejects.toThrow('parent');
  expect(actions).toEqual([]);
});

test('fix gates require twice-reproduced evidence and preserve existing-fix ownership', () => {
  const evidence = { baselineReproductions: 2, mediaConfirmed: true, runtimeCause: true, rejectionWindowClosed: true, humanOwnsFix: false, existingFix: false, budgetRemaining: true, baselineAndPatchedControl: true };
  expect(fixDecision(evidence)).toBe('fix');
  expect(fixDecision({ ...evidence, baselineReproductions: 1 })).toBe('stop');
  expect(fixDecision({ ...evidence, humanOwnsFix: true })).toBe('stop');
  expect(fixDecision({ ...evidence, existingFix: true })).toBe('verify-existing');
  expect(fixDecision({ ...evidence, budgetRemaining: false })).toBe('stop');
});

test('a fresh Pi process discovers all shared dependencies from the target project and no operational Benny skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-benny-discovery-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await installBenny(root);
  const { stdout } = await run(process.execPath, ['test/benny-discovery.mjs', root]);
  const skills = JSON.parse(stdout) as { name: string; filePath: string }[];
  const discovered = skills
    .filter((skill) => skill.filePath.startsWith(join(root, '.pi/skills')))
    .map((skill) => skill.name)
    .sort();
  expect(discovered).toEqual([...bennyDependencies].sort());
  expect(skills.some((skill) => ['setup-benny', 'triage-issue-reports', 'reproduce-and-fix-issues'].includes(skill.name))).toBe(false);
});

test('dirty or uncommitted runtime files block readiness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-benny-commit-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await run('git', ['init', '--quiet'], { cwd: root });
  await installBenny(root);
  await expect(bennyCommitted(root)).rejects.toThrow();
  await run('git', ['add', '.pi'], { cwd: root });
  await run('git', ['-c', 'user.name=Benny fixture', '-c', 'user.email=benny@example.invalid', 'commit', '--quiet', '-m', 'Fixture pack'], { cwd: root });
  expect(await bennyCommitted(root)).toMatchObject({ committed: true, paths: expect.arrayContaining(['.pi/automations/benny/skills/triage-issue-reports/SKILL.md']) });
  await writeFile(join(root, '.pi/automations/benny/skills/triage-issue-reports/SKILL.md'), 'unreviewed change');
  await expect(bennyCommitted(root)).rejects.toThrow();
});

test('configured marker text preserves trusted-author and thread checks', () => {
  const custom = { ...config, markers: { bug: '[bug]', performance: '[slow]', other: '[other]' } };
  expect(trustedVerdict(custom, source, { user: 'U-triage', channel: source.channel, thread_ts: source.thread, text: 'Confirmed.\n[slow]' })).toEqual({ kind: 'performance' });
  expect(trustedVerdict(custom, source, { user: 'U-triage', channel: source.channel, thread_ts: source.thread, text: '[benny:bug]' })).toBeUndefined();
});

test('a prior verdict makes repeated delivery a no-op', async () => {
  const actions: string[] = [];
  const adapter = {
    parent: async () => ({ ...source, exists: true, verdictExists: true }),
    createIssue: async () => {
      actions.push('create');
      return 'issue';
    },
    reply: async () => {
      actions.push('reply');
      return 'reply';
    },
    verifyReply: async () => true,
    compensate: async () => {},
    verifyCompensation: async () => true,
  };
  expect(await deliverVerdict(source, adapter, '[benny:bug]', issue)).toEqual({ kind: 'already-triaged' });
  expect(actions).toEqual([]);
});

test('the thread handoff creates one reply using the original immutable coordinates', async () => {
  const posts: unknown[] = [];
  const adapter = {
    parent: async () => ({ ...source, exists: true }),
    createIssue: async () => 'issue-1',
    reply: async (coordinates: typeof source, text: string) => {
      posts.push({ coordinates, text });
      return 'reply-1';
    },
    verifyReply: async () => true,
    compensate: async () => {},
    verifyCompensation: async () => true,
  };
  expect(await deliverVerdict(source, adapter, '[benny:bug]', issue)).toEqual({ kind: 'delivered', reply: 'reply-1', issue: 'issue-1' });
  expect(posts).toEqual([{ coordinates: source, text: '[benny:bug]' }]);
});

test('possible tracker duplicates fail the create gate before any write', async () => {
  const writes: string[] = [];
  const adapter = {
    parent: async () => ({ ...source, exists: true }),
    createIssue: async () => {
      writes.push('create');
      return 'issue-1';
    },
    reply: async () => {
      writes.push('reply');
      return 'reply-1';
    },
    verifyReply: async () => true,
    compensate: async () => {},
    verifyCompensation: async () => true,
  };
  await expect(deliverVerdict(source, adapter, '[benny:bug]', { ...issue, eligibility: { ...issue.eligibility, duplicate: 'possible' } })).rejects.toThrow('creation gate');
  expect(writes).toEqual([]);
});

test('a deleted parent between issue creation and posting compensates the issue and posts nothing', async () => {
  const actions: string[] = [];
  let reads = 0;
  const adapter = {
    parent: async () => ({ ...source, exists: ++reads === 1 }),
    createIssue: async () => {
      actions.push('create');
      return 'issue-1';
    },
    reply: async () => {
      actions.push('reply');
      return 'reply-1';
    },
    verifyReply: async () => true,
    compensate: async (id: string) => {
      actions.push(`cancel:${id}`);
    },
    verifyCompensation: async () => true,
  };
  await expect(deliverVerdict(source, adapter, '[benny:bug]', issue)).rejects.toThrow('compensated');
  expect(actions).toEqual(['create', 'cancel:issue-1']);
});

test('an ambiguous issue-creation failure does not claim that no ticket exists', async () => {
  const adapter = {
    parent: async () => ({ ...source, exists: true }),
    createIssue: async () => {
      throw new Error('response lost');
    },
    reply: async () => 'reply-1',
    verifyReply: async () => true,
    compensate: async () => {},
    verifyCompensation: async () => true,
  };
  await expect(deliverVerdict(source, adapter, '[benny:bug]', issue)).rejects.toThrow('issue creation is ambiguous');
});

test('installation refuses a symlinked project directory before writing outside the target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-benny-links-'));
  const outside = await mkdtemp(join(tmpdir(), 'pstack-benny-outside-'));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await symlink(outside, join(root, '.pi'));
  await expect(installBenny(root)).rejects.toThrow('symbolic link');
  expect(await readdir(outside)).toEqual([]);
});
