import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { removeSandbox } from './lib/driver.ts';

test('the family CLI keeps provider-error evidence even without --keep', () => {
  const evidence = mkdtempSync(join(tmpdir(), 'inconclusive-retention-'));
  let sandbox = '';
  try {
    const result = spawnSync(process.execPath, ['tests/workflow-parity/run-family.ts', 'how'], {
      cwd: join(import.meta.dirname, '../..'),
      env: {
        ...process.env,
        PSTACK_E2E_PI: join(import.meta.dirname, 'fixtures/fake-pi.mjs'),
        FAKE_PI_MODE: 'busy',
        FAKE_PI_BUSY_MS: '0',
        FAKE_PI_SESSION: join(import.meta.dirname, 'fixtures/sessions/parent-429.jsonl'),
        PSTACK_E2E_EVIDENCE_DIR: evidence,
      },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(3);
    const file = readdirSync(evidence).find((name) => name.endsWith('.json'));
    expect(file).toBeDefined();
    const record = JSON.parse(readFileSync(join(evidence, file ?? ''), 'utf8'));
    sandbox = record.sandbox;
    expect(record.inconclusive.kind).toBe('provider-error');
    expect(existsSync(join(sandbox, 'meta.json'))).toBe(true);
    expect(result.stdout).toContain(`sandbox kept: ${sandbox}`);
  } finally {
    if (sandbox !== '') removeSandbox(sandbox);
    rmSync(evidence, { recursive: true, force: true });
  }
});
