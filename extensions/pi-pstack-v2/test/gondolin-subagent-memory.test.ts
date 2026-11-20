import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type GondolinHost, loadGondolin } from './core-gondolin-host.ts';

vi.mock('@earendil-works/gondolin', async (importOriginal) => ({ ...(await importOriginal<typeof import('@earendil-works/gondolin')>()), VM: { create: vi.fn() } }));

const MEMORY_ENV = 'PI_SUBAGENT_MEMORY_DIR';
const NOTE = '/note.md';

let root = '';
let project = '';
let memoryDir = '';

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gondolin-memory-')));
  project = path.join(root, 'project');
  memoryDir = path.join(root, 'agent-memory', 'helper');
  fs.mkdirSync(project);
  fs.mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

const startVm = async (): Promise<GondolinHost> => {
  const host = loadGondolin({ cwd: project });
  await host.fire('session_start');
  return host;
};

const mountPoints = (host: GondolinHost): string[] => Object.keys(host.vmOptions()?.vfs?.mounts ?? {});

describe('the subagent memory directory in the guest', () => {
  test('is mounted at its host path and the guest can write notes in it', async () => {
    vi.stubEnv(MEMORY_ENV, memoryDir);
    const host = await startVm();
    const provider = host.vmOptions()?.vfs?.mounts?.[memoryDir];
    if (!provider) throw new Error(`Nothing was mounted at ${memoryDir}.`);
    const handle = await provider.open(NOTE, 'w');
    await handle.writeFile('remember this');
    await handle.close();
    expect(fs.readFileSync(path.join(memoryDir, NOTE), 'utf8')).toBe('remember this');
  });

  test('adds exactly one mount to what the guest has without it', async () => {
    const without = mountPoints(await startVm());
    vi.stubEnv(MEMORY_ENV, memoryDir);
    expect(mountPoints(await startVm()).toSorted()).toEqual([...without, memoryDir].toSorted());
  });

  test('changes nothing when the variable is unset or empty', async () => {
    const unset = mountPoints(await startVm());
    vi.stubEnv(MEMORY_ENV, '');
    expect(mountPoints(await startVm())).toEqual(unset);
  });

  test('is not mounted when the directory does not exist', async () => {
    const without = mountPoints(await startVm());
    vi.stubEnv(MEMORY_ENV, path.join(root, 'missing'));
    expect(mountPoints(await startVm())).toEqual(without);
  });

  test('is not mounted again when the workspace already holds it', async () => {
    const without = mountPoints(await startVm());
    const inside = path.join(project, '.pi', 'agent-memory');
    fs.mkdirSync(inside, { recursive: true });
    vi.stubEnv(MEMORY_ENV, inside);
    expect(mountPoints(await startVm())).toEqual(without);
  });
});
