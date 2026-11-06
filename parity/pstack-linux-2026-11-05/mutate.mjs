#!/usr/bin/env node
// Reintroduces one named defect, runs the tests that should catch it, and restores the file byte for byte.
// A mutation passes when its tests fail. Usage: mutate.mjs <name|all>   (run from the repository root)
// Receipts: .audit/pstack-linux-2026-11-05/mutations/<name>.txt
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG = 'extensions/pi-pstack';
const OUT = '.audit/pstack-linux-2026-11-05/mutations';
const OWNERSHIP = 'test/e2e/background-ownership.e2e.test.ts';

const MUTATIONS = {
  'child-hears-own-jobs': {
    file: 'src/index.ts',
    from: '          forward:\n            root !== undefined\n',
    to: '          forward:\n            false\n',
    tests: [OWNERSHIP, '-t', 'BG-OWN-1'],
  },
  'shutdown-silent': {
    file: 'src/background-shell.ts',
    from: '    jobs.shutdown(options.forward !== undefined);',
    to: '    jobs.shutdown(false);',
    tests: [OWNERSHIP, '-t', 'BG-OWN-3'],
  },
  'no-adoption': {
    file: 'src/task/tool.ts',
    from: '      const adopted = background && !detached && childIdentity.root !== undefined;',
    to: '      const adopted = false;',
    tests: [OWNERSHIP, '-t', 'BG-OWN-4'],
  },
  'adopted-outlives-root': {
    file: 'src/task/tool.ts',
    from: '    ...(adopted ? { [PARENT_ENV]: String(plan.root.pid) } : {}),\n',
    to: '',
    tests: [OWNERSHIP, '-t', 'process dies'],
  },
  'cloud-agent-not-own-root': {
    file: 'src/task/tool.ts',
    from: 'detached && !adopted ? undefined : plan.root, detached),',
    to: 'plan.root, detached),',
    tests: [OWNERSHIP, '-t', 'BG-OWN-7'],
  },
  'machine-runs-as-root': {
    file: 'src/cloud/machine.ts',
    from: '        ...hostUserArgs(),\n',
    to: '',
    tests: ['test/e2e/cloud-machine.e2e.test.ts', '-t', 'file tools act on the machine'],
    docker: true,
  },
  'no-hold': {
    file: 'src/inbox.ts',
    from: '          if (settled === undefined) handlers.shell(item.notice);',
    to: '          if (settled === undefined || item.from !== "") handlers.shell(item.notice);',
    tests: [OWNERSHIP, '-t', 'interactive main chat'],
  },
  'no-suppression': {
    file: 'src/background-shell.ts',
    from: '      if (!job.observed) {',
    to: '      if (true) {',
    tests: [OWNERSHIP, '-t', 'BG-OWN-6'],
  },
  'rules-injected': {
    file: 'src/sections.ts',
    from: "    ...(facts.activeTools.includes('Task') ? [cloudLine(facts.cloud)] : []),\n  ].join('\\n');",
    to: "    ...(facts.activeTools.includes('Task') ? [cloudLine(facts.cloud)] : []),\n    '- Always-applied engineering rules: Always place imports at the top of the module. Avoid inline imports.',\n  ].join('\\n');",
    tests: ['test/sections.test.ts', '-t', 'RULES-PLUGIN'],
  },
  'rule-every-request': {
    file: 'src/index.ts',
    from: '      await hostSections(pi, ctx, agents, rule),',
    to: '      await hostSections(pi, ctx, agents, sessionRule(ctx.cwd, rulePath())),',
    tests: ['test/e2e/host.e2e.test.ts', '-t', 'mid-session'],
  },
  'create-skill-redesigned': {
    file: 'skills/create-skill/SKILL.md',
    from: '### Phase 4: Verification',
    to: '### Phase 4: Draft, test, iterate',
    tests: ['test/resources.test.ts', '-t', 'CREATE-SKILL'],
  },
  'broken-link-outside-fence': {
    file: 'skills/create-skill/SKILL.md',
    from: '## Summary Checklist\n',
    to: '## Summary Checklist\n\nSee [the missing guide](missing-guide.md).\n',
    tests: ['test/resources.test.ts', '-t', 'RES-007'],
  },
  'rule-everywhere': {
    file: 'src/rule.ts',
    from: "  const inScope = below === '' || (!below.startsWith('..') && !isAbsolute(below));",
    to: '  const inScope = below !== undefined;',
    tests: ['test/e2e/host.e2e.test.ts', '-t', 'outside the home directory'],
  },
};

function run(name) {
  const mutation = MUTATIONS[name];
  if (mutation === undefined) throw new Error(`unknown mutation ${name}`);
  const path = join(PKG, mutation.file);
  const original = readFileSync(path);
  const text = original.toString('utf8');
  if (!text.includes(mutation.from)) throw new Error(`${name}: anchor not found in ${mutation.file}`);
  writeFileSync(path, text.replace(mutation.from, mutation.to));
  let output = '';
  let caught = false;
  try {
    // A container mutation runs under the docker group, which this shell may only reach through sg.
    const vitest = ['npx', 'vitest', 'run', ...mutation.tests];
    output =
      mutation.docker === true
        ? execFileSync('sg', ['docker', '-c', vitest.map((arg) => `'${arg}'`).join(' ')], { cwd: PKG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000 })
        : execFileSync(vitest[0], vitest.slice(1), { cwd: PKG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
  } catch (error) {
    caught = true;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  } finally {
    writeFileSync(path, original);
  }
  if (!readFileSync(path).equals(original)) throw new Error(`${name}: ${mutation.file} was not restored`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.txt`), `${caught ? 'CAUGHT' : 'MISSED'}\n${output}`);
  console.log(`${caught ? 'CAUGHT' : 'MISSED'}\t${name}`);
  return caught;
}

// A mutation edits source in place, so a gate running at the same time would check the mutant (it happened once: a
// make verify typecheck failed on a mutated line). Refuse to start while one runs.
try {
  execFileSync('pgrep', ['-f', '^make( [^ ]*)* verify'], { stdio: 'ignore' });
  throw new Error('make verify is running; run mutations after it ends');
} catch (error) {
  if (error.status !== 1) throw error;
}

const [target] = process.argv.slice(2);
const names = target === 'all' ? Object.keys(MUTATIONS) : [target];
const missed = names.filter((name) => !run(name));
if (missed.length > 0) process.exit(1);
