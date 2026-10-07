import { expect, test } from 'vitest';
import { redact } from '../../src/evidence/verification.ts';

const token = (prefix: string): string => `${prefix}${'a1B2c3D4e5'.repeat(4)}`;

test.for([
  ['token-only URL userinfo', `https://${token('github_pat_')}@github.com/acme/app.git`, 'https://<REDACTED>@github.com/acme/app.git'],
  ['GitLab token userinfo', `https://${token('glpat-')}@gitlab.com/acme/app.git`, 'https://<REDACTED>@gitlab.com/acme/app.git'],
  ['Slack webhook', `curl -X POST ${['https://hooks.slack.com', 'services', 'T000', 'B000', 'XXXXsecret'].join('/')}`, 'curl -X POST https://hooks.slack.com/services/<REDACTED>'],
  ['--token flag', `vercel deploy --prod --token ${token('')}`, 'vercel deploy --prod --token <REDACTED>'],
  ['token env assignment', `NPM_TOKEN=${token('npm_')} npm publish`, 'NPM_TOKEN=<REDACTED> npm publish'],
  ['PyPI token', `twine upload -p ${token('pypi-')} dist/*`, 'twine upload -p <REDACTED> dist/*'],
  ['bare GitHub fine-grained token', `echo ${token('github_pat_')}`, 'echo <REDACTED>'],
] as const)('redacts a %s', ([, input, expected]) => {
  expect(redact(input)).toBe(expected);
});

test('keeps an ssh git user', () => {
  expect(redact('ssh://git@github.com/acme/app.git')).toBe('ssh://git@github.com/acme/app.git');
});
