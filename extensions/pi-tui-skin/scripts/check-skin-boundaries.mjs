#!/usr/bin/env node
/**
 * Skin-boundary lint: this extension may style pi, never steer it.
 *
 * Fails (exit 1) when src/**\/*.ts calls a behavior-changing pi API, installs a
 * behavior-changing lifecycle hook, or deep-imports a pi package's internals.
 * Plain text scanning, so the lint has no build step of its own.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(PKG_ROOT, 'src');

const FORBIDDEN_CALLS = [
  '.sendMessage(',
  '.sendUserMessage(',
  '.appendEntry(',
  '.setActiveTools(',
  '.setModel(',
  '.setThinkingLevel(',
  '.shutdown(',
  'ctx.abort(',
  '.registerCommand(',
  '.registerShortcut(',
  '.registerMessageRenderer(',
  '.registerEntryRenderer(',
  '.registerMarkdownTransformer(',
  '.registerProvider(',
  '.registerFlag(',
  '.pasteToEditor(',
  '.setEditorText(',
];

const FORBIDDEN_EVENTS = [
  'tool_call',
  'input',
  'context',
  'context_with_system',
  'before_agent_start',
  'before_provider_request',
  'before_provider_headers',
  'message_end',
  'turn_end',
  'agent_before_settle',
  'user_bash',
  'resources_discover',
];

const DEEP_IMPORT = /@earendil-works\/[a-z0-9-]+\/(?:src|dist)\//;

/** Scan one file's text. Returns `{ rule, line, match }[]`. */
export function findViolations(text) {
  const found = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    for (const pattern of FORBIDDEN_CALLS) {
      if (line.includes(pattern)) found.push({ rule: 'behavior-api', line: lineNumber, match: pattern });
    }
    for (const event of FORBIDDEN_EVENTS) {
      for (const quote of ["'", '"']) {
        const pattern = `pi.on(${quote}${event}${quote}`;
        if (line.includes(pattern)) found.push({ rule: 'behavior-hook', line: lineNumber, match: pattern });
      }
    }
    const deep = line.match(DEEP_IMPORT);
    if (deep) found.push({ rule: 'deep-import', line: lineNumber, match: deep[0] });
  }
  return found;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(full);
  }
  return files;
}

function scanPackage() {
  const files = sourceFiles(SRC_DIR);
  const violations = [];
  for (const file of files) {
    for (const finding of findViolations(readFileSync(file, 'utf8'))) {
      violations.push({ path: relative(PKG_ROOT, file), ...finding });
    }
  }
  return { files, violations };
}

const SELF_TEST_FIXTURES = [
  {
    name: 'clean',
    text: `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function (pi: ExtensionAPI) {
  pi.on('session_start', () => {});
  pi.on('agent_start', () => {});
  pi.on('tool_execution_start', () => {});
  pi.registerTool({ name: 'style' });
  ctx.ui.setHeader(() => {});
  ctx.ui.setTheme('tui-skin');
}`,
    expected: [],
  },
  {
    name: 'behavior-api',
    text: `pi.sendMessage({ text: 'hi' });\npi.setModel('x');`,
    expected: ['behavior-api', 'behavior-api'],
  },
  {
    name: 'behavior-hook',
    text: `pi.on('tool_call', () => {});`,
    expected: ['behavior-hook'],
  },
  {
    name: 'deep-import',
    text: `import { secret } from '@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';`,
    expected: ['deep-import'],
  },
];

function selfTest() {
  for (const fixture of SELF_TEST_FIXTURES) {
    const rules = findViolations(fixture.text).map((finding) => finding.rule);
    assert.deepStrictEqual(rules, fixture.expected, `fixture "${fixture.name}"`);
  }
  process.stdout.write(`self-test: ${SELF_TEST_FIXTURES.length} fixtures passed\n`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const { files, violations } = scanPackage();
for (const violation of violations) {
  process.stdout.write(`${violation.path}:${violation.line}  ${violation.rule}  ${violation.match}\n`);
}
process.stdout.write(`violations: ${violations.length} in ${files.length} source files\n`);
process.exit(violations.length > 0 ? 1 : 0);
