import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createRpcSession } from '../.pi/skills/verify-pi-customizations/lib/rpc.mjs';
import { compareSkillInjection, stripFrontmatter } from '../.pi/skills/verify-pi-customizations/scenarios/lib/resource-surfaces.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? 'artifacts/user-perspective/caveman-command-case');
const scratch = mkdtempSync(join(tmpdir(), 'caveman-command-case-'));
const packagePath = join(root, 'extensions/pi-caveman');
const provider = join(root, '.pi/skills/verify-pi-customizations/scenarios/lib/resource-recorder-provider.mjs');
mkdirSync(output, { recursive: true });
const results = [];
try {
  for (const foreign of [false, true]) {
    const agentDir = join(scratch, foreign ? 'foreign' : 'owned');
    mkdirSync(join(agentDir, 'prompts'), { recursive: true });
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: [packagePath], defaultProvider: 'resource-recorder', defaultModel: 'recorder', defaultThinkingLevel: 'off' }));
    if (foreign) writeFileSync(join(agentDir, 'prompts/CAVEMAN-REVIEW.md'), 'FOREIGN_UPPERCASE_BODY $ARGUMENTS');
    const recorderPath = join(output, `${foreign ? 'foreign' : 'owned'}-received.jsonl`);
    writeFileSync(recorderPath, '');
    const session = createRpcSession({
      packagePath,
      agentDir,
      extraExtensions: [provider],
      capturePath: join(output, `${foreign ? 'foreign' : 'owned'}-rpc.jsonl`),
      env: { RESOURCE_RECORDER_PATH: recorderPath, PI_OFFLINE: '1', HOME: scratch, XDG_CONFIG_HOME: scratch, CAVEMAN_HOME: scratch, CAVEMAN_DEFAULT_MODE: 'manual' },
    });
    try {
      const commands = await session.commands();
      assert(commands.some((command) => command.name === 'caveman-review' && command.source === 'prompt'));
      if (foreign) assert(commands.some((command) => command.name === 'CAVEMAN-REVIEW' && command.source === 'prompt'));
      await session.prompt('/CAVEMAN-REVIEW CASE_SENTINEL');
      const received = readFileSync(recorderPath, 'utf8').trim().split('\n').map(JSON.parse);
      const userTexts = received.flatMap((record) => record.userTexts);
      const expanded = foreign
        ? userTexts.includes('FOREIGN_UPPERCASE_BODY CASE_SENTINEL')
        : compareSkillInjection({
            userTexts,
            name: 'caveman-review',
            location: join(packagePath, 'skills/caveman-review/SKILL.md'),
            body: stripFrontmatter(readFileSync(join(packagePath, 'skills/caveman-review/SKILL.md'), 'utf8')).trim(),
            args: 'CASE_SENTINEL',
          }).ok;
      const entries = session.entries.filter((entry) => entry.customType === 'caveman-mode');
      results.push({ foreign, commands: commands.filter((command) => /caveman-review/i.test(command.name)), userTexts, entries, expanded });
    } finally {
      await session.close();
    }
  }
  writeFileSync(join(output, 'summary.json'), `${JSON.stringify({ version: execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim(), results }, null, 2)}\n`);
  assert(
    results.every((result) => result.expanded),
    'uppercase commands must expand at the real provider boundary',
  );
  assert(!results[1].entries.some((entry) => entry.data?.mode === 'review'), 'foreign uppercase template must not change mode');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
