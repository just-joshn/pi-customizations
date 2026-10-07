import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { baseCavemanEnv, CAVEMAN_PACKAGE, closeCavemanSessions, prepareFixture, startCavemanSession, writeRaw } from './caveman-fixture.js';

function surfaceRows(repoRoot, kind) {
  const lines = readFileSync(join(repoRoot, 'docs/user-perspective-testing/surfaces.tsv'), 'utf8').trim().split('\n');
  const header = lines.shift().split('\t');
  const nameIndex = header.indexOf('name');
  const expectedIndex = header.indexOf('expected');
  return lines
    .map((line) => line.split('\t'))
    .filter((cells) => cells[1] === CAVEMAN_PACKAGE && cells[2] === kind)
    .map((cells) => ({ surfaceId: cells[0], name: cells[nameIndex], expected: cells[expectedIndex] }));
}

function writeDiscoveryReceipts({ receipts, rows, discovered, strip, evidence, extraMessage }) {
  const missing = rows.filter((row) => !discovered.has(row.name));
  const extras = [...discovered.keys()].filter((name) => !rows.some((row) => row.name === name));
  const discoveredNames = JSON.stringify([...discovered.keys()].sort());
  for (const row of rows) {
    const command = discovered.get(row.name);
    receipts.write({
      surfaceId: row.surfaceId,
      package: CAVEMAN_PACKAGE,
      expected: row.expected,
      observed: command ? `${strip}${row.name} discovered from ${command.sourceInfo.path}` : `${strip}${row.name} missing; discovered ${discoveredNames}`,
      evidence,
      verdict: command ? 'verified' : 'failed',
      reason: command ? null : `resource ${strip}${row.name} was not discovered by Pi`,
    });
  }
  assert.ok(missing.length === 0, `missing resources: ${missing.map((row) => row.name).join(', ')}`);
  if (extras.length > 0) throw new Error(`${extraMessage}: ${extras.join(', ')}`);
}

export default async function cavemanResources(context) {
  const { receipts, repoRoot } = context;
  const pkg = join(repoRoot, CAVEMAN_PACKAGE);
  prepareFixture(context.scratchDir);
  const session = startCavemanSession(context, baseCavemanEnv(context.scratchDir), { packagePath: pkg, captureName: 'rpc-resources.jsonl' });
  const evidence = session.capturePath;

  try {
    const commands = await session.commands();
    writeRaw(
      context,
      'commands.json',
      commands.map(({ name, source, sourceInfo }) => ({ name, source, path: sourceInfo?.path })),
    );

    const skills = new Map(commands.filter((command) => command.source === 'skill' && command.name.startsWith('skill:')).map((command) => [command.name.slice('skill:'.length), command]));
    writeDiscoveryReceipts({
      receipts,
      rows: surfaceRows(repoRoot, 'skill'),
      discovered: skills,
      strip: 'skill:',
      evidence,
      extraMessage: 'unexpected skill resources discovered',
    });

    const prompts = new Map(commands.filter((command) => command.source === 'prompt').map((command) => [command.name, command]));
    writeDiscoveryReceipts({
      receipts,
      rows: surfaceRows(repoRoot, 'prompt-template'),
      discovered: prompts,
      strip: '',
      evidence,
      extraMessage: 'unexpected prompt templates discovered',
    });

    const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    const manifestSource = manifest.pi.extensions[0];
    const extensionCommands = commands.filter((command) => command.source === 'extension' && command.sourceInfo?.origin === 'top-level');
    const cavemanCommands = extensionCommands.filter((command) => command.sourceInfo?.path?.startsWith(pkg));
    receipts.write({
      surfaceId: 'CV-INSTALL-1',
      package: CAVEMAN_PACKAGE,
      expected: "pi install of the package loads the manifest's declared entry point, the 22 skills and the 4 prompts.",
      observed: `pi.extensions=${JSON.stringify(manifest.pi.extensions)}; caveman commands from ${cavemanCommands[0]?.sourceInfo?.path}; ${skills.size} skill commands; ${prompts.size} prompt commands`,
      evidence,
      verdict: cavemanCommands.length === 5 && skills.size === 22 && prompts.size === 4 ? 'verified' : 'failed',
      reason: cavemanCommands.length === 5 && skills.size === 22 && prompts.size === 4 ? null : `expected 5 commands plus 22 skills and 4 prompts from the manifest entry, saw ${cavemanCommands.length}/${skills.size}/${prompts.size}`,
    });
    assert.equal(manifestSource, './src/index.ts', 'manifest entry point changed');
    assert.equal(cavemanCommands[0].sourceInfo.path, join(pkg, manifestSource), 'loaded entry point differs from the manifest');
    assert.equal(new Set(cavemanCommands.map((command) => command.sourceInfo.path)).size, 1, 'extension commands did not all come from one entry point');
  } finally {
    await closeCavemanSessions(context);
  }
}
