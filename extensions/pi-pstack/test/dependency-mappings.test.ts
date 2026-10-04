import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

async function generatedFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-dependency-mappings-'));
  try {
    await mkdir(join(directory, 'docs'));
    await mkdir(join(directory, 'scripts'));
    for (const path of ['upstream', 'upstream-team-kit', 'skills', 'prompts', 'host/adapters', 'package.json', 'scripts', 'docs/source-inventory.json', 'docs/team-kit-source-inventory.json', 'docs/resource-map.json']) {
      await cp(join(root, path), join(directory, path), {
        recursive: true,
        filter: (source) => !source.split('/').includes('node_modules'),
      });
    }
    execFileSync(process.execPath, [join(directory, 'scripts/resources.mjs'), '--policy-root', fileURLToPath(new URL('../../../', import.meta.url)), '--write'], { stdio: 'pipe' });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    directory,
    read: (path: string) => readFile(join(directory, path), 'utf8'),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

test('dependency mappings close documented host gaps without changing source snapshots', async () => {
  const fixture = await generatedFixture();
  try {
    const [deslop, shipping, multiPhase, autopilotFull, autopilotStack, verifyThis, swarm, originalDeslop] = await Promise.all([
      fixture.read('skills/deslop/SKILL.md'),
      fixture.read('skills/poteto-mode/playbooks/shipping.md'),
      fixture.read('skills/poteto-mode/playbooks/multi-phase-plan.md'),
      fixture.read('skills/poteto-mode/playbooks/autopilot-full.md'),
      fixture.read('skills/poteto-mode/playbooks/autopilot-stack.md'),
      fixture.read('skills/verify-this/SKILL.md'),
      fixture.read('skills/swarm/SKILL.md'),
      fixture.read('upstream-team-kit/skills/deslop/SKILL.md'),
    ]);

    expect(deslop).toContain("Find the pull request's actual base branch");
    expect(deslop).toContain('except comments that document invariants, constraints, security, compatibility, or user intent');
    expect(deslop).toContain('Preserve all comments that document constraints, invariants, security, compatibility, or user intent. Do not delete or rewrite them.');
    expect(originalDeslop).toContain('Check the diff against main');
    expect(shipping).not.toContain('map `VERIFIED` to `PASS`');
    expect(shipping).toContain('Each returns `PASS`, `PASS+NOTES` or `FAIL` and posts that verdict on its own PR.');
    expect(shipping).toContain('Run a local app lane on the machine that can reach the app');
    expect(shipping).toContain('Run a genuinely remote lane only through a separately configured remote executor');
    expect(multiPhase).toContain('read the bundled skill from the package path named by the pstack host contract');
    expect(multiPhase).toContain('Do not run `git show` for a skill path absent from the target repository');
    expect(multiPhase).not.toContain('privacy-sensitive workspace');
    expect(multiPhase).toContain('Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.');
    expect(autopilotFull).toContain('Keep an owner local when the app, simulator, credentials, transcripts, or IDE state are local');
    expect(autopilotStack).toContain('Keep an owner local when the app, simulator, credentials, transcripts, or IDE state are local');
    expect(autopilotFull).toContain('This package\'s `environment: "cloud"` worker runs on a configured independent VM');
    expect(verifyThis).toContain('VERIFIED, NOT VERIFIED, or INCONCLUSIVE');
    expect(swarm).toContain('Use `environment: "cloud"` for a configured independent VM');
    expect(swarm).toContain('subagent_type: generalPurpose');
    for (const workflow of [autopilotFull, autopilotStack, multiPhase]) {
      expect(workflow).toContain('/loop 1h');
      expect(workflow).not.toContain('cloud-sleeper');
    }
  } finally {
    await fixture.close();
  }
});

test('Pi create-skill defines repeatable draft and description optimization loops', async () => {
  const skill = await readFile(join(root, 'host/skills/create-skill/SKILL.md'), 'utf8');
  expect(skill).toContain('## Draft, test, and iterate');
  expect(skill).toContain('Run each task once without the proposed skill, then run the same task with the skill');
  expect(skill).toContain('## Optimize a description');
  expect(skill).toContain('keep the skill body fixed and change only the description');
});

test('bot UI discovers the native approved routine adapter', async () => {
  const fixture = await generatedFixture();
  try {
    expect(await fixture.read('skills/make-bot-ui/SKILL.md')).toBe((await readFile(join(root, 'host/adapters/make-bot-ui/SKILL.md'), 'utf8')).replaceAll('../../../upstream/', '../../upstream/'));
  } finally {
    await fixture.close();
  }
});

test('model setup remains the only ambient source skill and calls native confirmation', async () => {
  const fixture = await generatedFixture();
  try {
    const setup = await fixture.read('skills/setup-pstack/SKILL.md');
    expect(setup).not.toContain('disable-model-invocation: true');
    expect(setup).toContain('Call `pstack_setup`');
  } finally {
    await fixture.close();
  }
});
