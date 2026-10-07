import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PROVIDERS = [
  {
    surfaceId: 'AN-PROV-1',
    package: 'extensions/pi-anthropic-oauth',
    provider: 'claude-subscription',
    modelPattern: /claude-subscription\s+claude-opus/,
    rawName: 'claude-models.txt',
  },
  {
    surfaceId: 'AG-PROV-1',
    package: 'extensions/pi-antigravity-oauth',
    provider: 'google-antigravity',
    modelPattern: /google-antigravity\s+gemini-3\.6-flash\b/,
    rawName: 'antigravity-models.txt',
  },
  {
    surfaceId: 'XA-PROV-1',
    package: 'extensions/pi-xai-oauth',
    provider: 'grok-build',
    modelPattern: /grok-build\s+grok-4\.7-build-fast/,
    rawName: 'grok-build-models.txt',
  },
];

export default async function oauthProviders(context) {
  const { repoRoot, receipts, scratchDir, runPi, rawPath, log } = context;
  const credential = { type: 'oauth', access: 'fixture', refresh: 'fixture', expires: Date.UTC(2100, 0, 1) };
  const auth = {
    'claude-subscription': credential,
    'google-antigravity': { ...credential, projectId: 'fixture-project', email: 'fixture@example.com' },
    'grok-build': credential,
  };
  await writeFile(join(scratchDir, 'auth.json'), JSON.stringify(auth), { mode: 0o600 });

  for (const entry of PROVIDERS) {
    const output = runPi(['--no-extensions', '-e', join(repoRoot, entry.package), '--list-models', entry.provider]);
    const evidence = rawPath(entry.rawName);
    await writeFile(evidence, output, 'utf8');
    const matched = output.split('\n').find((line) => entry.modelPattern.test(line)) ?? '';
    receipts.assertVerdict({
      surfaceId: entry.surfaceId,
      package: entry.package,
      expected: `pi --list-models ${entry.provider} lists the models the extension registers`,
      observed: matched ? matched.trim() : `no matching model line; first lines: ${output.split('\n').slice(0, 3).join(' | ')}`,
      evidence,
      check: () => assert.match(output, entry.modelPattern, `Expected ${entry.provider} models not found`),
    });
  }
  log(`✓ ${PROVIDERS.length} provider receipts written for OAuth providers`);
}
