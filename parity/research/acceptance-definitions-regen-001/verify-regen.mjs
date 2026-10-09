#!/usr/bin/env node
/**
 * Verify regenerated acceptance bytes against the live requirements ledger.
 * Refuses to treat regeneration as freeze authorization.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const parityRoot = join(repoRoot, 'parity');

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exit(1);
}

function main() {
  const definitionsPath = join(parityRoot, 'acceptance', 'setup-pstack', 'definitions.json');
  const configurationsPath = join(
    parityRoot,
    'acceptance',
    'setup-pstack',
    'configurations.json',
  );
  const requirementsPath = join(parityRoot, 'requirements.json');
  const ledgerConfigsPath = join(parityRoot, 'configurations.json');

  for (const path of [definitionsPath, configurationsPath, requirementsPath, ledgerConfigsPath]) {
    if (!existsSync(path)) fail(`missing ${path}`);
  }

  const requirementsDoc = JSON.parse(readFileSync(requirementsPath, 'utf8'));
  const definitionsDoc = JSON.parse(readFileSync(definitionsPath, 'utf8'));
  const configurationsDoc = JSON.parse(readFileSync(configurationsPath, 'utf8'));
  const ledgerDoc = JSON.parse(readFileSync(ledgerConfigsPath, 'utf8'));

  const liveIds = new Set((requirementsDoc.requirements ?? []).map((r) => r.id));
  const defIds = new Set(
    (definitionsDoc.definitions ?? []).map((d) => d.requirementId ?? d.id),
  );

  const missing = [...liveIds].filter((id) => !defIds.has(id)).sort();
  const extra = [...defIds].filter((id) => !liveIds.has(id)).sort();

  if (requirementsDoc.acceptanceDefinitionsFrozen === true) {
    fail('live acceptanceDefinitionsFrozen is true; regen must not freeze ledgers');
  }
  if (definitionsDoc.frozen === true || definitionsDoc.status === 'FROZEN') {
    fail('definitions claim frozen/FROZEN; regeneration must remain DRAFT');
  }
  if (definitionsDoc.owner === 'implementation-parent') {
    fail('definitions.owner must not be implementation-parent');
  }
  if (configurationsDoc.owner === 'implementation-parent') {
    fail('configurations.owner must not be implementation-parent');
  }
  if (missing.length) fail(`definitions missing live requirement IDs: ${missing.join(', ')}`);
  if (extra.length) fail(`definitions have IDs absent from live ledger: ${extra.join(', ')}`);
  if (liveIds.size !== 98) {
    process.stderr.write(
      `WARN: live requirement count is ${liveIds.size}, brief expected 98\n`,
    );
  }

  const ledgerAxis = configurationsDoc.axes?.ledger ?? {};
  for (const cfg of ledgerDoc.configurations ?? []) {
    const key = `ledger.${cfg.id}`;
    if (!ledgerAxis[key]) fail(`configurations.json missing axis value ${key}`);
  }

  const custodyChecklist = {
    recordedDefinitionHashConsistent: 'n/a-regen',
    recordedConfigurationHashConsistent: 'n/a-regen',
    exactCandidateBytesPresent: 'PASS',
    independentOwnerNamed: 'FAIL',
    externalCustodyEstablished: 'FAIL',
    freezeAuthorizationGranted: 'FAIL',
    coverageDenominatorComplete:
      requirementsDoc.coverageDenominatorComplete === true ? 'PASS' : 'FAIL',
    supportingVerifierSafeForCustody: 'FAIL',
  };

  const result = {
    ok: true,
    definitionsSha256: sha256File(definitionsPath),
    configurationsSha256: sha256File(configurationsPath),
    requirementIdCount: defIds.size,
    liveRequirementCount: liveIds.size,
    liveRequirementCountExpected: 98,
    countsMatchLive: defIds.size === liveIds.size,
    acceptanceDefinitionsFrozenLive: requirementsDoc.acceptanceDefinitionsFrozen === true,
    definitionsOwner: definitionsDoc.owner ?? null,
    configurationsOwner: configurationsDoc.owner ?? null,
    refuseToForge:
      'Regeneration alone does not authorize freeze. External custody remains FAIL.',
    custodyChecklist,
    custodyExternalFail: custodyChecklist.externalCustodyEstablished === 'FAIL',
  };

  if (!result.custodyExternalFail) fail('custody checklist must keep external custody FAIL');
  if (result.acceptanceDefinitionsFrozenLive) fail('live freeze flag became true');

  writeFileSync(join(here, 'verify-output.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    'PASS: regen bytes present; ID coverage matches live ledger; freeze untouched; external custody FAIL.\n',
  );
}

main();
