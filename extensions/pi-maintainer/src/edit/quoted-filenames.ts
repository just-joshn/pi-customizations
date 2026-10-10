/** `aider/commands.py:parse_quoted_filenames`. Double-quoted spans or non-whitespace words. */
export function parseQuotedFilenames(args: string): string[] {
  const matches = args.matchAll(/"(.+?)"|(\S+)/g);
  const names: string[] = [];
  for (const match of matches) {
    const name = match[1] ?? match[2];
    if (name) names.push(name);
  }
  return names;
}
