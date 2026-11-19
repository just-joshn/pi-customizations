import { expect, test } from 'vitest';
import { privateEnv } from '../src/jobs.ts';

const JOB_TMP = '/job/tmp';
const JOB_TMP_CACHE = '/job/tmp/cache';
const JOB_TMP_NPM = '/job/tmp/npm';
const JOB_TMP_BUN = '/job/tmp/bun';

test('Chromium uses the same private temp directory as other tools without moving their caches', () => {
  expect(privateEnv(JOB_TMP)).toMatchObject({
    TMPDIR: JOB_TMP,
    TMP: JOB_TMP,
    TEMP: JOB_TMP,
    MAC_CHROMIUM_TMPDIR: JOB_TMP,
    XDG_CACHE_HOME: JOB_TMP_CACHE,
    npm_config_cache: JOB_TMP_NPM,
    BUN_INSTALL_CACHE_DIR: JOB_TMP_BUN,
  });
});
