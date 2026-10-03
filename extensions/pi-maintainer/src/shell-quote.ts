/**
 * Quote a filename as one shell word, mirroring the reference behavior of
 * delegating to the platform shell quoting rules: POSIX single-quote rules,
 * Windows double-quote rules.
 */

const POSIX_UNSAFE = /[^A-Za-z0-9_@%+=:,./-]/;

export function quotePosix(value: string): string {
  if (value.length === 0) return "''";
  if (!POSIX_UNSAFE.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function needsWindowsQuoting(value: string): boolean {
  return value.length === 0 || /[ \t\n"]/.test(value);
}

export function quoteWindows(value: string): string {
  if (!needsWindowsQuoting(value)) return value;
  let escaped = '';
  let backslashes = 0;
  for (const char of value) {
    if (char === '\\') {
      backslashes += 1;
      escaped += char;
      continue;
    }
    if (char === '"') {
      escaped += '\\'.repeat(backslashes + 1);
      backslashes = 0;
      escaped += char;
      continue;
    }
    backslashes = 0;
    escaped += char;
  }
  return `"${escaped}${'\\'.repeat(backslashes * 2)}"`;
}

export function quoteShellWord(value: string): string {
  return process.platform === 'win32' ? quoteWindows(value) : quotePosix(value);
}
