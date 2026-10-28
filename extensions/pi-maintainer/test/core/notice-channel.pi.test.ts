import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import { installMaintainer } from '../../src/core/install.ts';
import { defaultPromptPolicy } from '../../src/core/prompts.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { gitFeature } from '../../src/git/feature.ts';
import { commitFile, initRepo } from '../git/support.ts';
import { maintainerExtension, testPrompts } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle } from '../support/pi-session.ts';

/** Capture what a UI-less run can observe, the way a shell reading a print run would. */
function captureStderr(): string[] {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  onTestFinished(() => spy.mockRestore());
  return writes;
}

test('a settings problem reaches stderr with the loader detail when no UI exists', async () => {
  const stderr = captureStderr();
  const f = await piSessionFixture({ extension: maintainerExtension(), config: 'edit-format: whole\nbogus-option: true\n' });
  await f.open();
  expect(stderr.join('')).toContain('unrecognized option bogus-option');
  expect(f.errors.join('\n')).toContain('Invalid maintainer settings');
});

test('the commit announcement reaches stderr when no UI exists', async () => {
  const stderr = captureStderr();
  const extension = (pi: ExtensionAPI): void => {
    installMaintainer(pi, [editFeature, gitFeature], {
      promptSource: testPrompts,
      promptPolicy: defaultPromptPolicy,
      home: () => '/nonexistent-maintainer-home',
      processEnvironment: () => ({}),
    });
  };
  const f = await piSessionFixture({ extension, config: 'edit-format: whole\nfile: [hello.txt]\nyes-always: true\ngitignore: false\n' });
  await initRepo(f.cwd);
  await commitFile(f.cwd, 'hello.txt', 'before\n', 'seed');
  f.replies.push({ text: 'hello.txt\n```\nafter\n```\n' }, { text: 'feat: announce on stderr' });
  const session = await f.open();
  await promptAndSettle(session, 'change hello.txt');
  expect(stderr.join('')).toMatch(/Commit [0-9a-f]+ feat: announce on stderr/);
});
