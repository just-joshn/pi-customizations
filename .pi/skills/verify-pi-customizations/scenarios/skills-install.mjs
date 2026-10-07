import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeS50Sessions, gitInit, startS50Session } from './s50-fixture.js';

const EXPECTED = ['skill:doctor', 'skill:implement-cli-from-contract', 'skill:reverse-engineer-cli', 'skill:run', 'skill:simplify'];

function writeRaw(context, name, value) {
  const path = context.rawPath(name);
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function installRoot(context) {
  const project = join(context.scratchDir, 'skills-install-project');
  mkdirSync(join(project, '.pi'), { recursive: true });
  writeFileSync(join(project, 'README.md'), '# skills install project\n');
  gitInit(project);
  const installed = spawnSync('pi', ['install', '-l', '--approve', context.repoRoot], {
    cwd: project,
    env: { ...process.env, PI_CODING_AGENT_DIR: context.scratchDir, PI_OFFLINE: '1' },
    encoding: 'utf8',
  });
  const settingsPath = join(project, '.pi/settings.json');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
  const declaredPath = typeof settings?.packages?.[0] === 'string' ? settings.packages[0] : settings?.packages?.[0]?.source;
  const declaredResolved = declaredPath ? realpathSync(join(project, '.pi', declaredPath)) : null;
  return { project, installed, declaredPath, declaredResolved };
}

async function discoverRootSkills(context, project) {
  const noopPath = join(context.scratchDir, 'skills-noop-extension.js');
  writeFileSync(noopPath, 'export default function noop() {}\n');
  const session = startS50Session(context, {
    cwd: project,
    packagePath: noopPath,
    extraExtensions: [],
    allowGlobalExtensions: true,
    captureName: 'rpc-skills-install.jsonl',
  });
  const commands = await session.commands();
  const base = realpathSync(context.repoRoot);
  return {
    base,
    skills: commands
      .filter((command) => command.source === 'skill' && command.sourceInfo?.baseDir === base)
      .map((command) => command.name)
      .sort(),
  };
}

function writeReceipt(receipts, evidence, install, discovery, manifest, skillDirs) {
  receipts.assertVerdict({
    surfaceId: 'RS-INSTALL-1',
    package: 'skills',
    expected: 'the root package.json pi.skills declaration makes the five root skills discoverable after `pi install .`',
    observed: `pi install -l exit ${install.installed.status}; settings declares ${install.declaredPath} resolving to ${install.declaredResolved}; discovered ${JSON.stringify(discovery.skills)} with origin=package baseDir=${discovery.base}`,
    evidence,
    check: () => {
      assert.equal(install.installed.status, 0, `pi install exited ${install.installed.status}: ${install.installed.stderr}`);
      assert.deepEqual(manifest.pi?.skills, ['./skills']);
      assert.equal(install.declaredResolved, discovery.base, '.pi/settings.json package does not resolve to the repository root');
      assert.deepEqual(discovery.skills, EXPECTED, `expected five root skills, saw ${discovery.skills.join(', ')}`);
      assert.deepEqual(skillDirs, EXPECTED.map((name) => name.replace('skill:', '')).sort());
    },
  });
}

export default async function skillsInstall(context) {
  const { repoRoot, receipts, log } = context;
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const skillDirs = readdirSync(join(repoRoot, 'skills'))
    .filter((name) => existsSync(join(repoRoot, 'skills', name, 'SKILL.md')))
    .sort();
  const install = installRoot(context);
  try {
    const discovery = await discoverRootSkills(context, install.project);
    const evidence = writeRaw(context, 'skills-install.json', {
      installExit: install.installed.status,
      declaredResolved: install.declaredResolved,
      manifestSkills: manifest.pi?.skills,
      skillDirs,
      discovered: discovery.skills,
    });
    writeReceipt(receipts, evidence, install, discovery, manifest, skillDirs);
    log(`✓ RS-INSTALL-1 receipt written (${discovery.skills.length} root skills discovered)`);
  } finally {
    await closeS50Sessions(context);
  }
}
