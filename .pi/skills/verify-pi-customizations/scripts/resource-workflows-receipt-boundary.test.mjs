import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createReceipts } from '../lib/receipts.mjs';
import { writeOutcomeReceipt as local } from '../scenarios/resource-workflows-local.mjs';
import { writeOutcomeReceipt as recipes } from '../scenarios/resource-workflows-recipes.mjs';
import { writeOutcomeReceipt as contract } from '../scenarios/resource-workflows-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const expectations = [
  ['RS-SKILL-1', 'Reports Pi setup health, then applies only confirmed fixes'],
  ['RS-SKILL-2', 'Launches the real app per bundled recipes (cli, electron, library, playwright, server, tui)'],
  ['RS-SKILL-3', '4 parallel cleanup reviewers, then applies behavior-preserving fixes'],
  ['RS-SKILL-4', 'Evidence workspace `.re/`, probe scripts, behavior/architecture reports'],
  ['RS-SKILL-5', 'Differential implementation against a captured contract'],
];

for (const [scenario, boundary, cases] of [
  ['resource-workflows-local', local, expectations],
  ['resource-workflows-recipes', recipes, [expectations[1]]],
  ['resource-workflows-contract', contract, [expectations[4]]],
]) {
  for (const [surfaceId, expected] of cases) {
    test(`${scenario} writes the literal ${surfaceId} expectation, not its source citation`, () => {
      const receiptDir = mkdtempSync(join(tmpdir(), 'rw-receipt-'));
      try {
        const receipts = createReceipts({ scenario, receiptDir, repoRoot });
        boundary({ repoRoot, receipts }, {
          surfaceId,
          package: 'skills',
          observed: 'Genuine attempt failed. No promotion authorized.',
          evidence: join(receiptDir, 'attempt.json'),
          verdict: 'failed',
          reason: 'Existing failure is preserved.',
        });
        const receipt = JSON.parse(readFileSync(join(receiptDir, `${surfaceId}.json`), 'utf8'));
        assert.equal(receipt.expected, expected);
        assert.equal(receipt.verdict, 'failed');
      } finally {
        rmSync(receiptDir, { recursive: true, force: true });
      }
    });
  }
}
