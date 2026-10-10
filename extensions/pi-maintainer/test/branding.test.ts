import { expect, test } from 'vitest';
import { BRANDING, coAuthoredBy } from '../src/branding.ts';

test('operator-chosen Pi names replace Aider names', () => {
  expect(BRANDING).toEqual({
    ignoreFile: '.pimaintainerignore',
    gitignorePattern: '.pi-maintainer*',
    nameSuffix: ' (pi)',
    messagePrefix: 'pi: ',
    coAuthorName: 'pi',
    coAuthorEmail: 'noreply@pi.dev',
    envPrefix: 'PI_MAINTAINER_',
    tagsCacheDir: '.pi-maintainer.tags.cache.v4',
  });
});

test('co-author trailer carries the model with the configured email', () => {
  expect(coAuthoredBy('anthropic/claude-sonnet-4-5')).toBe('Co-authored-by: pi (anthropic/claude-sonnet-4-5) <noreply@pi.dev>');
  expect(coAuthoredBy('gpt-5', 'bot@example.com')).toBe('Co-authored-by: pi (gpt-5) <bot@example.com>');
});

test('the gitignore pattern covers runtime files, not the ignore file', () => {
  const pattern = new RegExp(`^${BRANDING.gitignorePattern.replace('.', '\\.').replace('*', '.*')}$`);
  expect(pattern.test(BRANDING.tagsCacheDir)).toBe(true);
  expect(pattern.test(BRANDING.ignoreFile)).toBe(false);
});
