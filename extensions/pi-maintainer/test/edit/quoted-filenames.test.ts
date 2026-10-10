import { expect, test } from 'vitest';
import { parseQuotedFilenames } from '../../src/edit/quoted-filenames.ts';

test('parseQuotedFilenames splits on whitespace and keeps double-quoted spans', () => {
  expect(parseQuotedFilenames('a.txt b.txt')).toEqual(['a.txt', 'b.txt']);
  expect(parseQuotedFilenames('"./file with spaces.py" plain.txt')).toEqual(['./file with spaces.py', 'plain.txt']);
  expect(parseQuotedFilenames('')).toEqual([]);
  expect(parseQuotedFilenames('  "only quoted"  ')).toEqual(['only quoted']);
});
