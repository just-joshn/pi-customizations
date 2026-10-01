import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifySkillCreation({ ctx, check, startPi }) {
  const locations = [
    { name: 'e2e-project', directory: join(ctx.directory, '.pi', 'skills', 'e2e-project') },
    { name: 'e2e-personal', directory: join(ctx.directory, 'skills', 'e2e-personal') },
  ];
  for (const { name, directory } of locations) {
    await mkdir(join(directory, 'scripts'), { recursive: true });
    await writeFile(join(directory, 'reference.md'), 'The literal expected output is skill-support-ok.\n');
    await writeFile(join(directory, 'scripts', 'verify.mjs'), "process.stdout.write('skill-support-ok\\n');\n");
    await writeFile(
      join(directory, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Verify a newly created Pi skill. Use for the local skill creation journey.\ndisable-model-invocation: true\n---\n# Created skill\n\nRead reference.md and run scripts/verify.mjs relative to this skill directory.\n`,
    );
  }
  const denied = await startPi(ctx.directory, ctx.log, ['--no-session', '--no-approve']);
  try {
    const commands = await denied.send({ type: 'get_commands' });
    check('create-skill: project trust denial hides the project skill', !commands.commands.some((command) => command.name === 'skill:e2e-project'));
    check(
      'create-skill: project trust denial retains the personal skill',
      commands.commands.some((command) => command.name === 'skill:e2e-personal'),
    );
  } finally {
    await denied.finish().catch(() => {});
    await denied.close().catch(() => {});
  }
  const instance = await startPi(ctx.directory, ctx.log, ['--no-session', '--approve']);
  try {
    await instance.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
    const commands = await instance.send({ type: 'get_commands' });
    for (const { name, directory } of locations) {
      check(
        `create-skill: ${name} is discovered`,
        commands.commands.some((command) => command.name === `skill:${name}` && command.source === 'skill'),
      );
      const request = await instance.turn(`/skill:${name} literal user request`);
      const text = request.messages.map((message) => (typeof message.content === 'string' ? message.content : (message.content ?? []).map((block) => block.text ?? '').join('\n'))).join('\n');
      const body = (await readFile(join(directory, 'SKILL.md'), 'utf8')).replace(/^---\n[\s\S]*?\n---\n/, '').trim();
      check(`create-skill: ${name} delivers its complete body`, text.includes(body));
      check(`create-skill: ${name} delivers its directory and user request`, text.includes(directory) && text.includes('literal user request'));
      check(`create-skill: ${name} support script executes from its directory`, execFileSync(process.execPath, ['scripts/verify.mjs'], { cwd: directory, encoding: 'utf8' }) === 'skill-support-ok\n');
    }
  } finally {
    await instance.finish().catch(() => {});
    await instance.close().catch(() => {});
  }
}
