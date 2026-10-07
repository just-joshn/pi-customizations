import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { createRpcSession } from '../lib/rpc.mjs';
import { closeS50Sessions, gitInit, S50_PACKAGE } from './s50-fixture.js';

function writeRaw(context, name, value) {
  const path = context.rawPath(name);
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function runBin(binPath, args) {
  const result = spawnSync(process.execPath, [binPath, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function assertCliBinary(context, receipts, packageDir, manifest) {
  const binTarget = join(packageDir, manifest.bin.s50);
  const executable = existsSync(binTarget) && (statSync(binTarget).mode & 0o111) !== 0;
  const bad = runBin(binTarget, ['bogus']);
  const noArgs = runBin(binTarget, []);
  const cliRaw = writeRaw(
    context,
    's50-cli.txt',
    [`bin.s50 target: ${manifest.bin.s50} (exists=${existsSync(binTarget)} executable=${executable})`, `$ s50 bogus -> exit ${bad.status}`, bad.stdout + bad.stderr, `$ s50 -> exit ${noArgs.status}`, noArgs.stdout + noArgs.stderr].join(
      '\n',
    ),
  );
  receipts.assertVerdict({
    surfaceId: 'S50-CMD-2',
    package: S50_PACKAGE,
    expected: 'the declared bin.s50 target exists and runs the same CLI as /s50 with usage text on a bad invocation and no Pi UI',
    observed: `target=${manifest.bin.s50} executable=${executable}; "s50 bogus" exited ${bad.status} printing ${JSON.stringify((bad.stdout + bad.stderr).trim().split('\n')[0])}`,
    evidence: cliRaw,
    check: () => {
      assert.ok(existsSync(binTarget), `bin.s50 target ${manifest.bin.s50} does not exist`);
      assert.ok(executable, 'bin.s50 target is not executable');
      assert.equal(bad.status, 1, 'bad invocation must exit 1');
      assert.match(bad.stdout + bad.stderr, /usage: s50 <command>/);
      assert.match(bad.stdout + bad.stderr, /unknown command: bogus/);
      assert.equal(noArgs.status, 1, 'missing command must exit 1');
      assert.match(noArgs.stdout + noArgs.stderr, /usage: s50 <command>/);
    },
  });
}

function assertSymlinkContract(context, receipts, packageDir, manifest) {
  const linkRoot = join(context.scratchDir, 's50link');
  mkdirSync(linkRoot, { recursive: true });
  const link = join(linkRoot, 'pi-s50');
  symlinkSync(packageDir, link, 'dir');
  const target = join(packageDir, manifest.bin.s50);
  const linkedBin = join(link, manifest.bin.s50);
  const executable = existsSync(target) && (statSync(target).mode & 0o111) !== 0;
  const direct = spawnSync(linkedBin, ['bogus'], { encoding: 'utf8' });
  const readme = readFileSync(join(packageDir, 'README.md'), 'utf8');
  const limitation = 'Node does not strip TypeScript types under `node_modules`, so a copy installed there cannot run the bin.';
  const invocation = 'node extensions/pi-s50/src/cli/main.ts status';
  const raw = writeRaw(context, 's50-symlink.json', {
    link,
    linkTarget: readlinkSync(link),
    target,
    executable,
    direct: { status: direct.status, stdout: direct.stdout, stderr: direct.stderr, error: direct.error?.message ?? null },
    readmeLines15to21: readme.split('\n').slice(14, 21).join('\n'),
    readmeLimitation: readme.includes(limitation),
    readmeInvocation: readme.includes(invocation),
  });
  const text = direct.stdout + direct.stderr;
  receipts.assertVerdict({
    surfaceId: 'S50-INSTALL-2',
    package: S50_PACKAGE,
    expected: 'the declared s50 bin target exists and runs when reached through a symlink into the checkout, and the README states that a node_modules copy cannot run it and gives the checkout invocation',
    observed: `target=${manifest.bin.s50} executable=${executable}; ${linkedBin} bogus exited ${direct.status} printing ${JSON.stringify(text.trim().split('\n')[0])}; README limitation=${readme.includes(limitation)} checkout invocation=${readme.includes(invocation)}`,
    evidence: raw,
    check: () => {
      assert.ok(existsSync(target), `bin.s50 target ${manifest.bin.s50} does not exist`);
      assert.ok(executable, 'bin.s50 target is not executable');
      assert.equal(direct.status, 1, `symlinked bin exited ${direct.status}: ${text}`);
      assert.match(text, /usage: s50 <command>/);
      assert.match(text, /unknown command: bogus/);
      assert.ok(readme.includes(limitation), 'README does not state the node_modules limitation');
      assert.ok(readme.includes(invocation), 'README does not give the checkout invocation');
    },
  });
}

function makeProject(scratchDir, name) {
  const project = join(scratchDir, name);
  mkdirSync(join(project, '.pi'), { recursive: true });
  writeFileSync(join(project, 'README.md'), `# ${name}\n`);
  gitInit(project);
  return project;
}

function installLocalShape(context, packageDir) {
  const project = makeProject(context.scratchDir, 'install-project');
  const agentDir = join(context.scratchDir, 'install-agent');
  mkdirSync(agentDir, { recursive: true });
  const installed = spawnSync('pi', ['install', '--approve', packageDir], {
    cwd: project,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' },
    encoding: 'utf8',
  });
  const settingsPath = join(agentDir, 'settings.json');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
  const declaredPath = typeof settings?.packages?.[0] === 'string' ? settings.packages[0] : settings?.packages?.[0]?.source;
  return { project, agentDir, installed, declaredPath, declaredResolved: declaredPath ? realpathSync(join(agentDir, declaredPath)) : null };
}

function searchBins(install) {
  const { project, agentDir } = install;
  const candidates = {
    'project node_modules/.bin/s50': join(project, 'node_modules/.bin/s50'),
    'project .pi/npm/node_modules/.bin/s50': join(project, '.pi/npm/node_modules/.bin/s50'),
    'project .pi/bin/s50': join(project, '.pi/bin/s50'),
    'project bin/s50': join(project, 'bin/s50'),
    'agent npm/node_modules/.bin/s50': join(agentDir, 'npm/node_modules/.bin/s50'),
    'agent node_modules/.bin/s50': join(agentDir, 'node_modules/.bin/s50'),
    'agent .pi/bin/s50': join(agentDir, '.pi/bin/s50'),
    'agent bin/s50': join(agentDir, 'bin/s50'),
    'home agent bin/s50': join(homedir(), '.pi/agent/bin/s50'),
  };
  const onPath = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => dir.length > 0 && existsSync(join(dir, 's50')))
    .map((dir) => join(dir, 's50'));
  return {
    searched: Object.fromEntries(Object.entries(candidates).map(([label, path]) => [label, { path, exists: existsSync(path) }])),
    onPath,
    which: spawnSync('which', ['s50'], { encoding: 'utf8' }).stdout.trim(),
  };
}

function installNpmShape(context, packageDir) {
  const project = makeProject(context.scratchDir, 'npm-install-project');
  const installed = spawnSync('pi', ['install', '-l', '--approve', `npm:file:${packageDir}`], {
    cwd: project,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: context.scratchDir,
      PI_OFFLINE: '1',
      npm_config_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      NO_UPDATE_NOTIFIER: '1',
    },
    encoding: 'utf8',
    timeout: 120000,
  });
  const linked = join(project, '.pi/npm/node_modules/.bin/s50');
  const present = existsSync(linked);
  return {
    project,
    status: installed.status,
    log: installed.stdout + installed.stderr,
    linked,
    linkTarget: present ? readlinkSync(linked) : null,
    present,
    run: present ? runBin(linked, ['bogus']) : null,
  };
}

async function collectInstallFacts(session, install, packageDir, manifest) {
  const commands = await session.commands();
  const base = realpathSync(packageDir);
  const owned = commands.filter((command) => command.sourceInfo?.baseDir === base);
  const pathOf = (command) => command.sourceInfo?.path ?? null;
  return {
    base,
    installExit: install.installed.status,
    declaredPath: install.declaredPath,
    declaredResolved: install.declaredResolved,
    manifestExtensions: manifest.pi?.extensions ?? [],
    manifestSkills: manifest.pi?.skills ?? [],
    owned: owned.map((command) => ({ name: command.name, source: command.source, origin: command.sourceInfo?.origin, path: pathOf(command) })),
    extensionCommands: owned.filter((command) => command.source === 'extension').map((command) => ({ name: command.name, path: pathOf(command) })),
    skillCommands: owned.filter((command) => command.source === 'skill').map((command) => ({ name: command.name, path: pathOf(command) })),
  };
}

function writeFindingEvidence(context, install, facts, control, packageDir) {
  const bins = searchBins(install);
  const localHits = Object.entries(bins.searched)
    .filter(([label, entry]) => entry.exists && (label.startsWith('project') || label.startsWith('agent')))
    .map(([label]) => label);
  return writeRaw(context, 's50-install.json', {
    package: packageDir,
    installExit: install.installed.status,
    installStdout: install.installed.stdout,
    declaredResolved: install.declaredResolved,
    owned: facts.owned,
    binSearch: bins,
    localHits,
    npmShape: control,
  });
}

function writeInstallReceipt(context, receipts, install, facts, manifest, packageDir) {
  const declaredExtension = manifest.pi?.extensions?.length === 1 ? realpathSync(join(packageDir, manifest.pi.extensions[0])) : null;
  const declaredSkill = join(packageDir, 'skills/s50/SKILL.md');
  const raw = writeRaw(context, 's50-install-1.json', {
    installExit: install.installed.status,
    declaredResolved: install.declaredResolved,
    manifestExtensions: facts.manifestExtensions,
    manifestSkills: facts.manifestSkills,
    declaredExtension,
    extensionCommands: facts.extensionCommands,
    skillCommands: facts.skillCommands,
  });
  receipts.assertVerdict({
    surfaceId: 'S50-INSTALL-1',
    package: S50_PACKAGE,
    expected: 'pi install ./extensions/pi-s50 loads the extension entry point declared in the package pi manifest and discovers exactly one skill named s50',
    observed: `pi install (user scope) exit ${install.installed.status} registered ${install.declaredPath}; manifest extensions=${JSON.stringify(facts.manifestExtensions)}; loaded extension commands=${JSON.stringify(facts.extensionCommands)}; loaded skill commands=${JSON.stringify(facts.skillCommands)}`,
    evidence: raw,
    check: () => {
      assert.equal(install.installed.status, 0, `pi install exited ${install.installed.status}: ${install.installed.stderr}`);
      assert.equal(install.declaredResolved, facts.base, '.pi/settings.json package does not resolve to the package directory');
      assert.deepEqual(facts.manifestExtensions, ['./src/index.ts'], 'manifest declares a different extension entry point');
      assert.deepEqual(facts.manifestSkills, ['./skills'], 'manifest declares a different skills path');
      assert.ok(declaredExtension && existsSync(declaredExtension), 'declared extension entry point does not exist');
      assert.deepEqual(
        facts.extensionCommands.map((command) => command.name),
        ['s50'],
        'extension command set',
      );
      assert.equal(realpathSync(facts.extensionCommands[0].path), declaredExtension, 'Pi loaded a different extension entry point');
      assert.deepEqual(
        facts.skillCommands.map((command) => command.name),
        ['skill:s50'],
        'Pi must discover exactly one skill named s50',
      );
      assert.equal(realpathSync(facts.skillCommands[0].path), realpathSync(declaredSkill), 'discovered skill is not skills/s50/SKILL.md');
    },
  });
}

export default async function s50Install(context) {
  const { repoRoot, receipts, log } = context;
  const packageDir = join(repoRoot, S50_PACKAGE);
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  assertCliBinary(context, receipts, packageDir, manifest);
  assertSymlinkContract(context, receipts, packageDir, manifest);

  const install = installLocalShape(context, packageDir);
  const noopPath = join(context.scratchDir, 's50-noop-extension.js');
  writeFileSync(noopPath, 'export default function noop() {}\n');
  context.s50Sessions ??= [];
  const session = createRpcSession({
    packagePath: noopPath,
    agentDir: install.agentDir,
    cwd: install.project,
    capturePath: context.rawPath('rpc-install.jsonl'),
    allowGlobalExtensions: true,
    extraExtensions: [],
    piBin: context.piBin,
  });
  context.s50Sessions.push(session);
  try {
    const facts = await collectInstallFacts(session, install, packageDir, manifest);
    const control = installNpmShape(context, packageDir);
    writeFindingEvidence(context, install, facts, control, packageDir);
    writeInstallReceipt(context, receipts, install, facts, manifest, packageDir);
  } finally {
    await closeS50Sessions(context);
  }
  log('✓ S50-CMD-2, S50-INSTALL-1 and S50-INSTALL-2 asserted');
}
