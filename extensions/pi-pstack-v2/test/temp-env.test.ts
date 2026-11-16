import { expect, test } from 'vitest';
import { privateEnv } from '../src/jobs.ts';

test('Chromium uses the same private temp directory as other tools without moving their caches', () => {
  expect(privateEnv('/job/tmp')).toMatchObject({
    TMPDIR: '/job/tmp', TMP: '/job/tmp', TEMP: '/job/tmp', MAC_CHROMIUM_TMPDIR: '/job/tmp',
    XDG_CACHE_HOME: '/job/tmp/cache', npm_config_cache: '/job/tmp/npm', BUN_INSTALL_CACHE_DIR: '/job/tmp/bun',
  });
});
