#!/usr/bin/env node
// Reintroduces one named defect, runs the tests that should catch it, and restores the file byte for byte.
// Usage: mutate.mjs <name|all>   (run from the repository root; receipts go to .audit/pstack-complete-2026-11-05/mutations/)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG = 'extensions/pi-pstack';
const OUT = '.audit/pstack-complete-2026-11-05/mutations';

const MUTATIONS = {
  'shutdown-kills-cloud': {
    file: 'src/task/registry.ts',
    from: '      if (entry.detached) entry.handle.detach?.();\n      else entry.handle.kill();',
    to: '      entry.handle.kill();',
    tests: ['test/e2e/cloud-machine.e2e.test.ts', '-t', 'keeps running after its chat closes'],
  },
  'tools-not-routed': {
    file: 'src/index.ts',
    from: '  if (machine !== undefined) registerMachineTools(pi, machine);',
    to: '',
    tests: ['test/e2e/cloud-machine.e2e.test.ts', '-t', 'file tools act on the machine'],
    cleanup: ['/tmp/machine-only'],
  },
  'machine-not-stopped': {
    file: 'src/cloud/detached.ts',
    from: '  \'if [ -n "$PSTACK_MACHINE_CONTAINER" ]; then docker $PSTACK_DOCKER_PREFIX stop --time 5 "$PSTACK_MACHINE_CONTAINER" >/dev/null 2>&1; fi\',\n',
    to: '',
    tests: ['test/e2e/cloud-machine.e2e.test.ts', '-t', 'fresh clone of the pushed remote'],
  },
  'clone-from-local': {
    file: 'src/cloud/checkout.ts',
    from: "'--origin', 'origin', base.remote.url, dest]",
    to: "'--origin', 'origin', cwd, dest]",
    tests: ['test/e2e/cloud-machine.e2e.test.ts', '-t', 'fresh clone of the pushed remote'],
  },
  'no-reattach': {
    file: 'src/task/tool.ts',
    from: "    if (message !== undefined && ctx.hasUI) ctx.ui.notify(message, 'warning');\n    reattach(ctx);",
    to: "    if (message !== undefined && ctx.hasUI) ctx.ui.notify(message, 'warning');",
    tests: ['test/e2e/cloud-machine.e2e.test.ts', '-t', 'keeps running after its chat closes'],
  },
  'in-cloud-not-handled': {
    file: 'src/cloud/in-cloud.ts',
    from: "    return { action: 'handled' };",
    to: "    return { action: 'continue' };",
    tests: ['test/e2e/in-cloud.e2e.test.ts'],
  },
};

function run(name) {
  const mutation = MUTATIONS[name];
  if (mutation === undefined) throw new Error(`unknown mutation ${name}`);
  const path = join(PKG, mutation.file);
  const original = readFileSync(path);
  const text = original.toString('utf8');
  if (text.split(mutation.from).length !== 2) throw new Error(`${name}: the target text is not in ${path} exactly once`);
  writeFileSync(path, text.replace(mutation.from, mutation.to));
  let output = '';
  let caught = false;
  try {
    output = execFileSync('npx', ['vitest', 'run', ...mutation.tests], { cwd: PKG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
  } catch (error) {
    caught = true;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  } finally {
    writeFileSync(path, original);
    for (const leftover of mutation.cleanup ?? []) rmSync(leftover, { recursive: true, force: true });
  }
  if (!readFileSync(path).equals(original)) throw new Error(`${name}: ${path} was not restored`);
  mkdirSync(OUT, { recursive: true });
  const summary = output
    .split('\n')
    .filter((line) => /Tests? |FAIL|✓|×/.test(line))
    .slice(-12)
    .join('\n');
  writeFileSync(join(OUT, `${name}.txt`), `${caught ? 'CAUGHT' : 'MISSED'}\n${summary}\n`);
  console.log(`${name}: ${caught ? 'CAUGHT' : 'MISSED'}`);
  return caught;
}

const [which = 'all'] = process.argv.slice(2);
const names = which === 'all' ? Object.keys(MUTATIONS) : which.split(',');
const missed = names.filter((name) => !run(name));
if (missed.length > 0) {
  console.error(`missed: ${missed.join(', ')}`);
  process.exit(1);
}
