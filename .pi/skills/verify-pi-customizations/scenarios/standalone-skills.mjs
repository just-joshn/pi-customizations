import assert from 'node:assert/strict';

const SKILLS = [
  { surfaceId: 'RS-SKILL-1', name: 'skill:doctor' },
  { surfaceId: 'RS-SKILL-2', name: 'skill:run' },
  { surfaceId: 'RS-SKILL-3', name: 'skill:simplify' },
  { surfaceId: 'RS-SKILL-4', name: 'skill:reverse-engineer-cli' },
  { surfaceId: 'RS-SKILL-5', name: 'skill:implement-cli-from-contract' },
];

export default async function standaloneSkills(context) {
  const { repoRoot, receipts, startSession, log } = context;
  const session = startSession({ packagePath: repoRoot });
  try {
    const commands = await session.commands();
    const skillCommands = commands.filter((command) => command.source === 'skill');

    for (const { surfaceId, name } of SKILLS) {
      const command = skillCommands.find((candidate) => candidate.name === name);
      receipts.assertVerdict({
        surfaceId,
        package: 'skills',
        expected: `${name} is registered as a Pi skill command from the root package skill declaration`,
        observed: command ? `${command.name}: ${command.description ?? '(no description)'}` : `missing; registered skill commands: ${skillCommands.map((candidate) => candidate.name).join(', ')}`,
        evidence: session.capturePath,
        check: () => assert.ok(command, `Expected standalone skill ${name} not registered`),
      });
    }
    log(`✓ ${SKILLS.length} RS-SKILL receipts written for standalone skills`);
  } finally {
    await session.close();
  }
}
