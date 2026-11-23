import { TWO } from './types.ts';

export const DIFF_READ_SUBCOMMANDS = new Set<string>(['diff', 'show', 'diff-tree', 'diff-files', 'diff-index', 'whatchanged']);

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

export function hasPatchFlag(words: readonly string[]): boolean {
  return words.some((word) => PATCH_FLAGS.has(word) || word.startsWith('-U') || word.startsWith('-S') || word.startsWith('-G') || word.startsWith('--unified=') || word.startsWith('--diff-merges=') || word.startsWith('--word-diff='));
}

export function hasDangerousDiffFlag(words: readonly string[]): boolean {
  return words.some((word) => {
    if (!word.startsWith('--')) {
      return false;
    }
    const option = word.split('=')[0] ?? '';
    return option.length > TWO && DANGEROUS_DIFF_FLAGS.some((flag) => flag.startsWith(option));
  });
}

export function hasSafeDiffFlags(words: readonly string[]): boolean {
  return SAFE_DIFF_FLAGS.every((flag) => words.includes(flag));
}

export function isAllowedDiffArgs(words: readonly string[]): boolean {
  return !hasDangerousDiffFlag(words) && hasSafeDiffFlags(words);
}
