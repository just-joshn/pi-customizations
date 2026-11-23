import { ZERO } from './types.ts';

const TAG_LIST_FLAGS = new Set<string>(['-l', '--list', '-n', '--contains', '--no-contains', '--points-at', '--merged', '--no-merged']);

const TAG_PASSIVE_FLAGS = new Set<string>(['-i', '--ignore-case', '--no-ignore-case', '--column', '--no-column', '--color', '--no-color', '--sort', '--format', '--omit-empty', '--no-omit-empty']);

const TAG_VERIFY_FLAGS = new Set<string>(['-v', '--verify']);

function tagReadKind(arg: string): 'list' | 'verify' | 'passive' | undefined {
  if (/^-n[0-9]+$/.test(arg)) {
    return 'list';
  }
  const name = arg.split('=')[0] ?? '';
  if (TAG_LIST_FLAGS.has(name)) {
    return 'list';
  }
  if (TAG_VERIFY_FLAGS.has(name)) {
    return 'verify';
  }
  if (TAG_PASSIVE_FLAGS.has(name)) {
    return 'passive';
  }
  return undefined;
}

/** Listing, filtering, and signature checks. Only those read flags are accepted. `-d` and `--force` write. */
export function isAllowedTagArgs(args: readonly string[]): boolean {
  if (args.length === ZERO) {
    return true;
  }
  let listMode = false;
  let verifyMode = false;
  let positional = false;
  for (const arg of args) {
    if (arg.startsWith('-')) {
      const kind = tagReadKind(arg);
      if (kind === undefined) {
        return false;
      }
      if (kind === 'list') {
        listMode = true;
      }
      if (kind === 'verify') {
        verifyMode = true;
      }
      continue;
    }
    positional = true;
  }
  return !positional || listMode || verifyMode;
}
