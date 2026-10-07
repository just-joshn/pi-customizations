#!/usr/bin/env node
// Runs upstream's Claude Code hooks (caveman-activate.js, caveman-mode-tracker.js) from the pinned
// checkout through scripted sessions and records the exact context each hook hands the model.
// test/hook-differential.test.ts replays the same sessions through the Pi extension.
// Usage: node scripts/capture-hook-oracle.mjs [--check]   (CAVEMAN_CHECKOUT defaults to /tmp/caveman)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checkout = resolve(process.env['CAVEMAN_CHECKOUT'] ?? '/tmp/caveman');
const target = join(root, 'test/upstream/hook-oracle.json');

const SCENARIOS = [
  {
    defaultMode: 'caveman',
    prompts: [
      'explain closures',
      '/caveman ultra',
      'explain closures',
      '/caveman status',
      '/caveman wenyan',
      'explain closures',
      '/caveman lite',
      'explain closures',
      '/caveman-review',
      'explain closures',
      'stop caveman',
      'explain closures',
      'talk like caveman',
      'explain closures',
      'normal mode',
      'explain closures',
      '/caveman',
      'explain closures',
    ],
  },
  { defaultMode: 'ultracave', prompts: ['explain closures'] },
  { defaultMode: 'megacave', prompts: ['explain closures'] },
  { defaultMode: 'off', prompts: ['explain closures', '/caveman', 'explain closures'] },
  { defaultMode: 'manual', prompts: ['explain closures', '/caveman', 'explain closures'] },
];

// The temporary home is the only host-incidental value in the hook output.
function hook(script, payload, env) {
  const out = execFileSync(process.execPath, [join(checkout, 'src/hooks', script)], { input: JSON.stringify(payload), env, encoding: 'utf8' }).replaceAll(env.HOME, '<HOME>');
  if (!out.trim()) return '';
  if (script === 'caveman-activate.js') return out;
  return JSON.parse(out).hookSpecificOutput?.additionalContext ?? '';
}

function capture({ defaultMode, prompts }) {
  const home = mkdtempSync(join(tmpdir(), 'caveman-oracle-'));
  const env = { PATH: process.env['PATH'], HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CAVEMAN_DEFAULT_MODE: defaultMode };
  try {
    const session = hook('caveman-activate.js', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' }, env);
    const steps = prompts.map((prompt) => ({ prompt, context: hook('caveman-mode-tracker.js', { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt }, env) }));
    return { defaultMode, session, steps };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const oracle = `${JSON.stringify({ commit: head, scenarios: SCENARIOS.map(capture) }, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== oracle) {
    process.stderr.write('test/upstream/hook-oracle.json differs from the hooks at the pinned checkout; rerun capture-hook-oracle.mjs\n');
    process.exit(1);
  }
  process.stdout.write('hook oracle matches the pinned hooks\n');
} else {
  writeFileSync(target, oracle);
  process.stdout.write(`wrote ${target}\n`);
}
