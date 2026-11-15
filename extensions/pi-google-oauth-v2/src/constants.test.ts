import { expect, test } from 'vitest';
import { CODE_ASSIST_BASE_URL, PROJECT_HEADER } from './constants.ts';

test('the project header is lowercase and namespaced away from Google headers', () => {
  expect(PROJECT_HEADER).toBe('x-pi-google-project');
});

test('the base url has no trailing slash because methods append :name', () => {
  expect(CODE_ASSIST_BASE_URL).toBe('https://cloudcode-pa.googleapis.com/v1internal');
});
