#!/usr/bin/env node
// Native-first gate for the pi-subagents source (extensions/AGENTS.md: native Pi mechanism, then the
// Extension API, then the SDK, and custom infrastructure only where those cannot represent the need).
// Each rule bans a pattern that stands in for a Pi mechanism. A file may keep the pattern only when it
// is listed in the rule's `allowed` set, and docs/subagents-native-gaps.md must record why.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const rules = [
  {
    id: 'settings-manager',
    pattern: /SettingsManager\.create\(/,
    allowed: ['src/subagents/child-settings.ts'],
    advice: 'read settings with pi.getSettings(), which honours project trust; a child session gets childSettings()',
  },
  { id: 'poll-timer', pattern: /\bsetInterval\(/, allowed: [], advice: 'react to Pi events and signals instead of polling on a timer' },
  {
    id: 'child-process',
    pattern: /from 'node:child_process'/,
    allowed: ['src/subagents/tracked-bash.ts', 'src/subagents/shell-command.ts', 'src/subagents/rpc-child.ts', 'src/subagents/rem-launcher.ts'],
    advice: 'run commands with pi.exec; spawn only what pi.exec cannot express, and record it in docs/subagents-native-gaps.md',
  },
  {
    id: 'side-file',
    pattern: /\b(?:writeFileSync|appendFileSync|renameSync)\(/,
    allowed: ['src/subagents.ts', 'src/subagents/context-board.ts', 'src/subagents/subagent-preferences.ts'],
    advice: 'keep durable session data in pi.appendEntry entries; only data that spans sessions belongs in a file',
  },
];

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });

function sources(root) {
  const directory = join(root, 'src/subagents');
  const files = existsSync(directory) ? walk(directory) : [];
  const entry = join(root, 'src/subagents.ts');
  return existsSync(entry) ? [entry, ...files] : files;
}

export function scan(root = packageRoot) {
  const found = [];
  for (const file of sources(root)) {
    const path = relative(root, file);
    const text = readFileSync(file, 'utf8');
    for (const rule of rules) {
      if (rule.pattern.test(text) && !rule.allowed.includes(path)) found.push({ rule: rule.id, path, advice: rule.advice });
    }
    if (/outputSchema:/.test(text) && !/structuredContent/.test(text)) found.push({ rule: 'output-schema', path, advice: 'a tool that declares outputSchema must return the matching structuredContent' });
  }
  return found;
}

export function undocumentedExceptions(root = packageRoot) {
  const gaps = readFileSync(join(root, 'docs/subagents-native-gaps.md'), 'utf8');
  return rules.flatMap((rule) => rule.allowed.filter((path) => !gaps.includes(path)).map((path) => ({ rule: rule.id, path, advice: 'record the exception in docs/subagents-native-gaps.md' })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = [...scan(), ...undocumentedExceptions()];
  for (const problem of problems) process.stderr.write(`${problem.path}: ${problem.rule}: ${problem.advice}\n`);
  process.stdout.write(`pi-subagents native-first gate: ${problems.length} violations.\n`);
  process.exit(problems.length ? 1 : 0);
}
