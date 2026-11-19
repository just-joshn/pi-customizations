import { expect, test } from 'vitest';
import { CONTAINED_ENV, JOB_DIR_ENV, TOP_DIR_ENV } from '../src/container.ts';
import { jobEnv, privateEnv } from '../src/jobs.ts';

test('a job keeps temp files and package caches in its private temp directory on the host, and sets no macOS-only variable', () => {
  const env = privateEnv('/job/tmp');
  expect(env).toMatchObject({
    TMPDIR: '/job/tmp',
    TMP: '/job/tmp',
    TEMP: '/job/tmp',
    XDG_CACHE_HOME: '/job/tmp/cache',
    npm_config_cache: '/job/tmp/npm',
    BUN_INSTALL_CACHE_DIR: '/job/tmp/bun',
  });
  expect(Object.keys(env)).not.toEqual(expect.arrayContaining(['MAC_CHROMIUM_TMPDIR', 'TMPPREFIX']));
});

test('the container gets only the job variables and a short list of host ones, never the host environment', () => {
  const env = jobEnv({ dir: '/jobs/a', top: '/jobs/top', agentDir: '/jobs/a/agent' }, { PATH: '/host/bin', HOME: '/Users/me', GH_TOKEN: 't', ANTHROPIC_API_KEY: 'k', SSH_AUTH_SOCK: '/sock', LANG: 'C' });
  expect(env).toMatchObject({
    [CONTAINED_ENV]: '1',
    [JOB_DIR_ENV]: '/jobs/a',
    [TOP_DIR_ENV]: '/jobs/top',
    PI_CODING_AGENT_DIR: '/jobs/a/agent',
    HOME: '/jobs/a/tmp/home',
    TMPDIR: '/jobs/a/tmp',
    GH_TOKEN: 't',
    ANTHROPIC_API_KEY: 'k',
    LANG: 'C',
  });
  expect(Object.keys(env)).not.toEqual(expect.arrayContaining(['PATH', 'SSH_AUTH_SOCK']));
});

test("a command a worker starts shares the worker's temp directory but keeps its own home", () => {
  expect(jobEnv({ dir: '/jobs/a', top: '/jobs/top', agentDir: '/x', tmp: '/jobs/worker/tmp' }, {})).toMatchObject({ TMPDIR: '/jobs/worker/tmp', HOME: '/jobs/a/tmp/home', XDG_CACHE_HOME: '/jobs/a/tmp/cache' });
});
