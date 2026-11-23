import { TWO, ZERO } from './types.ts';

export const DIFF_READ_SUBCOMMANDS = new Set<string>(['diff', 'show', 'diff-tree', 'whatchanged']);

const DANGEROUS_DIFF_FLAGS = ['--ext-diff', '--textconv'];
const SAFE_DIFF_FLAGS = ['--no-ext-diff', '--no-textconv'];
const PATCH_FLAGS = new Set<string>([
  '-p',
  '--patch',
  '--patch-with-stat',
  '--patch-with-raw',
  '-c',
  '--cc',
  '--combined-all-paths',
  '--binary',
  '--diff-merges',
  '--remerge-diff',
  '-u',
  '--unified',
  '-W',
  '--function-context',
  '--color-words',
  '--word-diff',
]);

export function gitOptionWords(words: readonly string[]): readonly string[] {
  const separator = words.indexOf('--');
  return separator < ZERO ? words : words.slice(ZERO, separator);
}

export function hasPatchFlag(words: readonly string[]): boolean {
  const options = gitOptionWords(words);
  return options.some(
    (word) =>
      PATCH_FLAGS.has(word) ||
      word.startsWith('-L') ||
      word.startsWith('--line-range') ||
      word.startsWith('-U') ||
      word.startsWith('-S') ||
      word.startsWith('-G') ||
      word.startsWith('--unified=') ||
      word.startsWith('--diff-merges=') ||
      word.startsWith('--word-diff='),
  );
}

export function hasDangerousDiffFlag(words: readonly string[]): boolean {
  const options = gitOptionWords(words);
  return options.some((word) => {
    if (!word.startsWith('--')) {
      return false;
    }
    const option = word.split('=')[0] ?? '';
    return option.length > TWO && DANGEROUS_DIFF_FLAGS.some((flag) => flag.startsWith(option));
  });
}

export function hasSafeDiffFlags(words: readonly string[]): boolean {
  const options = gitOptionWords(words);
  return SAFE_DIFF_FLAGS.every((flag) => options.includes(flag));
}

export function isAllowedDiffArgs(words: readonly string[]): boolean {
  return !hasDangerousDiffFlag(words) && hasSafeDiffFlags(words);
}
