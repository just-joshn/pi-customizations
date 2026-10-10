/** `aider/main.py:parse_lint_cmds` without the IO side effects. Invalid empty commands are dropped. */
export function parseLintCmds(lintCmds: readonly string[]): Map<string | null, string> {
  const res = new Map<string | null, string>();
  for (const lintCmd of lintCmds) {
    let lang: string | null;
    let cmd: string;
    if (/^[a-z]+:/.test(lintCmd)) {
      const pieces = lintCmd.split(':');
      lang = (pieces[0] ?? '').trim();
      cmd = lintCmd.slice(lang.length + 1).trim();
    } else {
      lang = null;
      cmd = lintCmd.trim();
    }
    if (cmd) res.set(lang, cmd);
  }
  return res;
}
