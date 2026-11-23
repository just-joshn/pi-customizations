#!/usr/bin/env node
/** Real read-only command guard checks for quoted, escaped, and encoded non-git options. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isSafeReadOnlyCommand, sandboxReadOnlyCommand } from '../../src/readonly-guard.ts';

const root = mkdtempSync(join(tmpdir(), 'pi-readonly-commands-'));
writeFileSync(join(root, 'a.txt'), 'needle\n');
let failures = 0;

function run(command) {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    stdout = execFileSync('/bin/ksh', ['-c', sandboxReadOnlyCommand(command)], { cwd: root, timeout: 8000, encoding: 'utf8' });
  } catch (error) {
    code = error.status ?? 1;
    stdout = `${error.stdout ?? ''}`;
    stderr = `${error.stderr ?? ''}`;
  }
  const combined = `${stdout}${stderr}`;
  const safe = isSafeReadOnlyCommand(command);
  console.log('CMD', command.replaceAll('\n', '\\n'), 'safe', safe, 'code', code);
  console.log('OUT', combined.slice(0, 300).replaceAll('\n', ' | '));
  return { combined, safe };
}

const find = run('find . "-exec" /bin/echo P0FIND {} +');
if (find.safe || find.combined.includes('P0FIND')) {
  failures += 1;
}

const awkShell = run('awk $\'BEGIN { sys\\164em("echo AWKEXEC") }\'');
if (awkShell.safe || awkShell.combined.includes('AWKEXEC')) {
  failures += 1;
}

const awkLiteral = run('awk \'BEGIN { sys\\164em("echo AWKLITERAL") }\'');
if (awkLiteral.safe || awkLiteral.combined.includes('AWKLITERAL')) {
  failures += 1;
}

writeFileSync(join(root, 'big.txt'), 'b\na\n');
writeFileSync(join(root, 'compress.sh'), '#!/bin/sh\necho P0SORT_EXEC >&2\ncat\n');
execFileSync('chmod', ['+x', join(root, 'compress.sh')]);
const sortCompress = run(`sort -S 1k --compress-prog=${join(root, 'compress.sh')} ${join(root, 'big.txt')}`);
if (sortCompress.safe || sortCompress.combined.includes('P0SORT_EXEC')) {
  failures += 1;
}

writeFileSync(join(root, 'keys.lesskey'), '#env\nLESSOPEN=|echo P0LESS_EXEC %s\n');
writeFileSync(join(root, 'less-file.txt'), 'less body\n');
const lessKey = run(`less --lesskey-src ${join(root, 'keys.lesskey')} ${join(root, 'less-file.txt')}`);
if (lessKey.safe || lessKey.combined.includes('P0LESS_EXEC')) {
  failures += 1;
}

if (failures > 0) {
  console.error('FAIL: a read-only command executed a quoted, escaped, or encoded option');
  process.exitCode = 1;
} else {
  console.log('PASS: quoted, escaped, and encoded non-git options were blocked');
}
rmSync(root, { recursive: true, force: true });
