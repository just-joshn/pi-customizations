import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type ConfigEnvironment, findRepoConfigPath, getDefaultMode, userConfigPath } from '../src/config.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'caveman-config-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const environment = (env: NodeJS.ProcessEnv = {}): ConfigEnvironment => ({ env, platform: 'linux', home: join(root, 'home') });
const writeJson = (path: string, value: unknown): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

describe('getDefaultMode', () => {
  test('falls back to caveman', () => {
    expect(getDefaultMode(root, environment())).toBe('caveman');
  });

  test('the environment variable wins over every file', () => {
    writeJson(join(root, '.caveman.json'), { defaultMode: 'off' });
    expect(getDefaultMode(root, environment({ CAVEMAN_DEFAULT_MODE: 'wenyan' }))).toBe('megacave');
  });

  test('repo config is found from a nested directory', () => {
    writeJson(join(root, 'repo', '.caveman', 'config.json'), { defaultMode: 'ultra' });
    mkdirSync(join(root, 'repo', 'src', 'deep'), { recursive: true });
    expect(getDefaultMode(join(root, 'repo', 'src', 'deep'), environment())).toBe('ultracave');
  });

  test('repo config beats user config', () => {
    writeJson(join(root, 'home', '.config', 'caveman', 'config.json'), { defaultMode: 'megacave' });
    writeJson(join(root, '.caveman.json'), { defaultMode: 'manual' });
    expect(getDefaultMode(root, environment())).toBe('manual');
  });

  test('user config applies when no repo config exists', () => {
    writeJson(join(root, 'xdg', 'caveman', 'config.json'), { defaultMode: 'off' });
    expect(getDefaultMode(root, environment({ XDG_CONFIG_HOME: join(root, 'xdg') }))).toBe('off');
  });

  test('invalid values fall through to the next source', () => {
    writeJson(join(root, '.caveman.json'), { defaultMode: 'loud' });
    expect(getDefaultMode(root, environment({ CAVEMAN_DEFAULT_MODE: 'shouty' }))).toBe('caveman');
  });

  test('a symlinked repo config is ignored', () => {
    writeJson(join(root, 'elsewhere.json'), { defaultMode: 'off' });
    symlinkSync(join(root, 'elsewhere.json'), join(root, '.caveman.json'));
    expect(getDefaultMode(root, environment())).toBe('caveman');
  });
});

describe('userConfigPath', () => {
  test('uses APPDATA on Windows', () => {
    expect(userConfigPath({ env: { APPDATA: 'C:/Users/me/AppData/Roaming' }, platform: 'win32', home: 'C:/Users/me' })).toBe(join('C:/Users/me/AppData/Roaming', 'caveman', 'config.json'));
  });
});

describe('findRepoConfigPath', () => {
  test('prefers .caveman/config.json over .caveman.json', () => {
    writeJson(join(root, '.caveman', 'config.json'), {});
    writeJson(join(root, '.caveman.json'), {});
    expect(findRepoConfigPath(root)).toBe(join(root, '.caveman', 'config.json'));
  });

  test('returns null when no ancestor has a config', () => {
    mkdirSync(join(root, 'a'));
    expect(findRepoConfigPath(join(root, 'a'))).toBe(null);
  });
});
