/**
 * Parses lint command entries. An entry matching ^[a-z]+:.* names a language
 * before the first colon; anything else is the language-less global command.
 * An entry whose command is empty produces the parse error text and marks the
 * whole parse as failed.
 */

import type { LintCommandEntry, LintCommands } from './types.ts';

const LANGUAGE_PREFIX = /^[a-z]+:.*/;

export interface ParseMessage {
  readonly channel: 'error' | 'output';
  readonly text: string;
}

export interface ParseLintCmdsResult {
  readonly commands: LintCommands | undefined;
  readonly messages: readonly ParseMessage[];
}

const PARSE_FAILURE_HINT = 'The arg should be "language: cmd --args ..."';
const PARSE_FAILURE_EXAMPLE = 'For example: --lint-cmd "python: flake8 --select=E9"';

export function parseLintCmds(entries: readonly string[]): ParseLintCmdsResult {
  const messages: ParseMessage[] = [];
  const promptEntries = new Map<string, LintCommandEntry>();
  let global: string | undefined;
  const byLanguage = new Map<string, string>();
  for (const entry of entries) {
    let lang: string | undefined;
    let cmd: string;
    if (LANGUAGE_PREFIX.test(entry)) {
      const splitAt = entry.indexOf(':');
      lang = entry.slice(0, splitAt).trim();
      cmd = entry.slice(splitAt + 1).trim();
    } else {
      cmd = entry.trim();
    }

    if (cmd.length > 0) {
      // The reference keeps one prompt line per language at its first-seen
      // position, with the last command given for that language.
      promptEntries.set(lang ?? '', { lang, cmd });
      if (lang === undefined) {
        global = cmd;
      } else {
        byLanguage.set(lang, cmd);
      }
      continue;
    }

    messages.push({ channel: 'error', text: `Unable to parse --lint-cmd "${entry}"` });
    messages.push({ channel: 'output', text: PARSE_FAILURE_HINT });
    messages.push({ channel: 'output', text: PARSE_FAILURE_EXAMPLE });
  }

  if (messages.length > 0) return { commands: undefined, messages };
  return { commands: { entries: [...promptEntries.values()], global, byLanguage }, messages };
}
