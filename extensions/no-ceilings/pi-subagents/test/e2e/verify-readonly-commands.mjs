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

const awkShell = run("awk $'BEGIN { sys\\164em(\"echo AWKEXEC\") }'");
if (awkShell.safe || awkShell.combined.includes('AWKEXEC')) {
  failures += 1;
}

const awkLiteral = run("awk 'BEGIN { sys\\164em(\"echo AWKLITERAL\") }'");
if (awkLiteral.safe || awkLiteral.combined.includes('AWKLITERAL')) {
  failures += 1;
}

if (failures > 0) {
  console.error('FAIL: a read-only command executed a quoted, escaped, or encoded option');
  process.exitCode = 1;
} else {
  console.log('PASS: quoted, escaped, and encoded non-git options were blocked');
}
rmSync(root, { recursive: true, force: true });
