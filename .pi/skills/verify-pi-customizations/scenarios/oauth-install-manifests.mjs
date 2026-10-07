import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ANTHROPIC_PACKAGE, ANTHROPIC_PROVIDER, ANTIGRAVITY_PACKAGE, ANTIGRAVITY_PROVIDER, offlineEnv, REPO_ROOT, readText, runPi, writeJson, XAI_PACKAGE, XAI_PROVIDER } from './oauth-support/harness.mjs';

const PACKAGES = [
  {
    surfaceId: 'AN-INSTALL-1',
    slug: 'anthropic',
    package: ANTHROPIC_PACKAGE,
    provider: ANTHROPIC_PROVIDER,
    model: 'claude-sonnet-4-6',
    credential: { type: 'oauth', access: 'sk-ant-oat01-fixture', refresh: 'fixture', expires: Date.UTC(2100, 0, 1) },
  },
  {
    surfaceId: 'AG-INSTALL-1',
    slug: 'antigravity',
    package: ANTIGRAVITY_PACKAGE,
    provider: ANTIGRAVITY_PROVIDER,
    model: 'gemini-3.1-pro',
    credential: { type: 'oauth', access: 'ya29.fixture', refresh: '1//fixture', expires: Date.UTC(2100, 0, 1), projectId: 'fixture-project' },
  },
  {
    surfaceId: 'XA-INSTALL-1',
    slug: 'xai',
    package: XAI_PACKAGE,
    provider: XAI_PROVIDER,
    model: 'grok-4.7-xhigh-fast',
    credential: { type: 'oauth', access: 'fixture', refresh: 'fixture', expires: Date.UTC(2100, 0, 1) },
  },
];

function modelIds(output, provider) {
  return output
    .split('\n')
    .filter((line) => line.startsWith(`${provider} `))
    .map((line) => line.split(/\s+/)[1]);
}

export default async function oauthInstallManifests(context) {
  const { receipts, log, rawPath } = context;
  for (const entry of PACKAGES) {
    const agentDir = join(context.scratchDir, `install-${entry.slug}`);
    await mkdir(agentDir, { recursive: true });
    const packageDir = join(REPO_ROOT, entry.package);
    const install = await runPi(context.piBin, ['install', packageDir], { agentDir, cwd: agentDir, env: { PI_OFFLINE: '1' } });
    const settings = readText(join(agentDir, 'settings.json'));
    await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [entry.provider]: entry.credential }), { mode: 0o600 });
    const list = await runPi(context.piBin, ['--offline', '--list-models', entry.provider], {
      agentDir,
      cwd: agentDir,
      env: offlineEnv({ logPath: join(agentDir, 'routes.log') }),
    });
    const ids = modelIds(list.stdout, entry.provider);
    const capture = { package: entry.package, provider: entry.provider, install, settings, list, ids };
    writeJson(rawPath(`${entry.surfaceId}.json`), capture);
    receipts.assertVerdict({
      surfaceId: entry.surfaceId,
      package: entry.package,
      expected: 'Loads `./src/index.ts`',
      observed: `pi install ${entry.package} exit=${install.code}; settings.json packages=${JSON.stringify(JSON.parse(settings).packages)}; next run without -e: pi --list-models ${entry.provider} exit=${list.code} listed ${ids.length} models including ${entry.model}: ${ids.includes(entry.model)}`,
      evidence: rawPath(`${entry.surfaceId}.json`),
      check: () => {
        assert.equal(install.code, 0, `pi install failed: ${install.stderr}`);
        assert.ok(
          JSON.parse(settings).packages.some((registered) => registered.endsWith(entry.package.split('/').at(-1))),
          'settings.json did not register the package',
        );
        assert.equal(list.code, 0, `pi --list-models failed: ${list.stderr}`);
        assert.ok(ids.length > 0, `no ${entry.provider} models were listed from the installed package`);
        assert.ok(ids.includes(entry.model), `installed package did not provide ${entry.model}; listed ${ids.join(', ')}`);
      },
    });
  }
  log('✓ AN-INSTALL-1, AG-INSTALL-1 and XA-INSTALL-1 receipts written from installed manifests');
}
