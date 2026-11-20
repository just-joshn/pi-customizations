import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { VirtualProvider } from '@earendil-works/gondolin';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { GUEST, loadGondolin } from './core-gondolin-host.ts';

vi.mock('@earendil-works/gondolin', async (importOriginal) => ({ ...(await importOriginal<typeof import('@earendil-works/gondolin')>()), VM: { create: vi.fn() } }));

const EROFS = os.constants.errno.EROFS;
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const WRITE_PROBE = '/write-probe.txt';
const SKILL_FILE = '/SKILL.md';
const TILDE_SKILLS = '~/tilde-skills';
const RELATIVE_SKILLS = '../agent-relative';

let root = '';
let agentDir = '';
let homeDir = '';
let localCwd = '';

const makeDir = (...parts: string[]): string => {
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const writeSettings = (settings: unknown): void => {
  fs.writeFileSync(path.join(agentDir, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
};

/** Starts a session and returns what the extension mounted besides the workspace, in mount order. */
const startSession = async () => {
  const host = loadGondolin({ cwd: localCwd });
  await host.fire('session_start');
  const mounts = host.vmOptions()?.vfs?.mounts ?? {};
  return { mounts, extra: Object.keys(mounts).filter((mountPoint) => mountPoint !== GUEST) };
};

const ErrnoSchema = z.looseObject({ errno: z.number().optional() });
const errnoOf = (operation: Promise<unknown>) =>
  operation.then(
    () => undefined,
    (error: unknown) => ErrnoSchema.safeParse(error).data?.errno,
  );

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gondolin-skills-')));
  agentDir = makeDir('agent');
  homeDir = makeDir('home');
  localCwd = makeDir('project');
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  vi.stubEnv('HOME', homeDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('which skill directories the VM mounts', () => {
  test('mounts the package, agent skills, shared skills, and settings paths', async () => {
    const agentSkills = makeDir('agent', 'skills');
    const sharedSkills = makeDir('home', '.agents', 'skills');
    const absolute = makeDir('elsewhere', 'absolute');
    const tilde = makeDir('home', 'tilde-skills');
    const relative = makeDir('agent-relative');
    writeSettings({ skills: [absolute, TILDE_SKILLS, RELATIVE_SKILLS] });
    const mounted = (await startSession()).extra;
    expect(mounted.toSorted()).toEqual([PACKAGE_ROOT, agentSkills, sharedSkills, absolute, tilde, relative].toSorted());
  });

  test('skips missing paths and non-directory files in settings', async () => {
    const agentSkills = makeDir('agent', 'skills');
    fs.writeFileSync(path.join(root, 'a-file'), '');
    writeSettings({ skills: [path.join(root, 'missing'), path.join(root, 'a-file')] });
    expect((await startSession()).extra.toSorted()).toEqual([PACKAGE_ROOT, agentSkills].toSorted());
  });

  test.for(['{not json', '{"skills": "nope"}'])('ignores unreadable or invalid settings %s', async (contents) => {
    const agentSkills = makeDir('agent', 'skills');
    writeSettings(contents);
    expect((await startSession()).extra.toSorted()).toEqual([PACKAGE_ROOT, agentSkills].toSorted());
  });

  test('paths inside the workspace are left to the workspace mount', async () => {
    writeSettings({ skills: [makeDir('project', 'skills')] });
    expect((await startSession()).extra).toEqual([PACKAGE_ROOT]);
  });

  test('duplicates and directories inside an already mounted one are mounted once', async () => {
    const agentSkills = makeDir('agent', 'skills');
    const nested = makeDir('agent', 'skills', 'nested');
    writeSettings({ skills: [agentSkills, nested, PACKAGE_ROOT] });
    expect((await startSession()).extra.toSorted()).toEqual([PACKAGE_ROOT, agentSkills].toSorted());
  });
});

const readableAt = async (provider: VirtualProvider, guestPath: string): Promise<string> => {
  const handle = await provider.open(guestPath, 'r');
  try {
    return (await handle.readFile()).toString();
  } finally {
    await handle.close();
  }
};

describe('the skills the guest reads', () => {
  test.for([['agent', 'skills'], ['home', '.agents', 'skills'], ['listed', 'skills']])('skills under %s are readable at their host path and cannot be written', async (parts) => {
    const skills = makeDir(...parts);
    writeSettings({ skills: [makeDir('listed', 'skills')] });
    fs.writeFileSync(path.join(skills, SKILL_FILE), 'skill body');
    const provider = (await startSession()).mounts[skills];
    if (!provider) throw new Error(`The extension mounted nothing at ${skills}.`);
    expect(await readableAt(provider, SKILL_FILE)).toBe('skill body');
    expect(await errnoOf(provider.open(WRITE_PROBE, 'w'))).toBe(EROFS);
    expect(fs.existsSync(path.join(skills, WRITE_PROBE))).toBe(false);
  });
});
