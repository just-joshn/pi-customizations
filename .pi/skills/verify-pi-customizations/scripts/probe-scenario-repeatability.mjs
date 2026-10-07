import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const driver = join(root, '.pi/skills/verify-pi-customizations/bin/control-pi');
const cases = [
  { scenario: 'pstack-env-variables', file: 'env-16-rem.log', content: 'STALE_CONSOLIDATION_RECORD\n' },
  { scenario: 'pstack-config-files', file: 'cfg-12-status-line.log', content: `${JSON.stringify({ tasks: ['STALE_TASK'], projectDir: '/stale', cwd: '/stale' })}\n` },
];
for (const { scenario, file, content } of cases) {
  test(`${scenario} ignores recorder output from a previous drive`, () => {
    const output = mkdtempSync(join(tmpdir(), 'pi-repeated-drive-'));
    try {
      mkdirSync(join(output, 'raw'));
      writeFileSync(join(output, 'raw', file), content);
      const result = spawnSync(process.execPath, [driver, 'drive', scenario, '--out', output], { cwd: root, encoding: 'utf8', timeout: 300000 });
      assert.equal(result.error, undefined, 'scenario process must finish');
      assert.equal(result.status, 0, `${scenario} must verify the current run, not the seeded historical record\n${result.stdout}\n${result.stderr}`);
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
}
