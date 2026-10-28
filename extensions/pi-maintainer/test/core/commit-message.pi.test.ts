import type { Model } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { installMaintainer } from '../../src/core/install.ts';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { defaultPromptPolicy } from '../../src/core/prompts.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { gitFeature } from '../../src/git/feature.ts';
import { commitFile, initRepo } from '../git/support.ts';
import { testPrompts, textOf } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle, scriptedModel } from '../support/pi-session.ts';

const weakModel: Model<string> = { ...scriptedModel, id: 'scripted-weak', name: 'Scripted weak' };

const extension = (pi: ExtensionAPI): void => {
  installMaintainer(pi, [editFeature, gitFeature], {
    promptSource: testPrompts,
    promptPolicy: defaultPromptPolicy,
    home: () => '/nonexistent-maintainer-home',
    processEnvironment: () => ({}),
  });
};

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const outcome = await isolatedExec({ command: 'git', args, cwd }, env);
  if (outcome.code !== 0) throw new Error(`git ${args.join(' ')}: ${outcome.stderr || outcome.stdout}`);
  return outcome.stdout;
};

test('an assistant commit is authored by the weak model and trailers the main model', async () => {
  const f = await piSessionFixture({
    extension,
    models: [weakModel],
    config: 'edit-format: whole\nfile: [hello.txt]\nyes-always: true\ngitignore: false\nweak-model: scripted-weak\n',
  });
  await initRepo(f.cwd);
  await commitFile(f.cwd, 'hello.txt', 'before\n', 'seed');
  f.replies.push({ text: 'hello.txt\n```\nafter\n```\n' }, { text: 'feat: add greeting' });
  const session = await f.open();
  await promptAndSettle(session, 'change hello.txt');

  expect(await git(f.cwd, ['log', '-1', '--pretty=%s'])).toBe('feat: add greeting\n');
  expect(await git(f.cwd, ['log', '-1', '--pretty=%B'])).toContain('Co-authored-by: pi (scripted) <noreply@pi.dev>');
  expect(f.routedModels).toEqual(['scripted', 'scripted-weak']);
  expect(f.requests).toHaveLength(2);
  const messages = f.requests[1]?.messages ?? [];
  expect(
    messages
      .filter((message) => message.role === 'system')
      .map(textOf)
      .join('\n'),
  ).toContain('one-line Git commit messages');
  const user = messages
    .filter((message) => message.role === 'user')
    .map(textOf)
    .join('\n');
  expect(user).toContain('# Diffs:');
  expect(user).toContain('after');
  expect(f.errors).toEqual([]);
});
