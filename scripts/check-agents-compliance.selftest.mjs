#!/usr/bin/env node
// Proves every rule fires on a known-bad fixture and stays quiet on a clean one.
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { audit } from './check-agents-compliance.mjs';
import { closeTypeScriptSources } from './typescript-source.mjs';

const longFunction = (count) => ['export function longOne(a: number): number {', ...Array.from({ length: count }, (_, index) => `  const v${index} = a + ${index};`), '  return a;', '}'].join('\n');

const nestedFunction = `export function deep(a: number): number {
  if (a > 1) {
    if (a > 2) {
      if (a > 3) {
        if (a > 4) {
          if (a > 5) return 5;
        }
      }
    }
  }
  return a;
}
`;

const writeFunction = `export function setMode(record: { mode: string }): void {
  record.mode = 'plan';
}
`;

const vendoredBanner = '// Vendored from @earendil-works/pi-ai 0.87.1 src/api/example.ts (MIT) by scripts/vendor-pi-ai.mjs. Only import specifiers differ. Do not edit.\n';
const fakeKey = `sk-${'a'.repeat(24)}`;
const fakeTokenValue = 'b'.repeat(12);
const pythonCli = ['import sys', '', 'def main():', "    print('reporting')", '', "if __name__ == '__main__':", '    main()', ''].join('\n');
const pythonLibrary = ['def report():', "    print('quiet')", ''].join('\n');

const clean = {
  'src/clean.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
};

const cases = [
  ['clean fixture', {}, []],
  ['oversized file', { 'src/big.ts': `export const values = [\n${Array.from({ length: 810 }, (_, index) => `  ${index},`).join('\n')}\n];\n` }, ['file-length']],
  ['oversized function', { 'src/long.ts': longFunction(60) }, ['function-length']],
  ['deep nesting', { 'src/deep.ts': nestedFunction }, ['nesting-depth']],
  ['console.log in library code', { 'src/log.ts': "export function logIt(): void {\n  console.log('hello');\n}\n" }, ['console-log']],
  ['parameter field write', { 'src/write.ts': writeFunction }, ['parameter-mutation']],
  ['empty catch', { 'src/swallow.ts': "export function swallow(): void {\n  try {\n    JSON.parse('{}');\n  } catch {}\n}\n" }, ['empty-catch']],
  ['secret-shaped literal', { 'src/secret.ts': `export const key = '${fakeKey}';\n` }, ['hardcoded-secret']],
  ['named secret property', { 'src/named.ts': `export const config = { token: '${fakeTokenValue}' };\n` }, ['hardcoded-secret']],
  ['secret env fallback', { 'src/env.ts': `export const token = process.env.API_TOKEN ?? '${fakeTokenValue}';\n` }, ['env-fallback']],
  ['config env fallback is allowed', { 'src/host.ts': "export const host = process.env.PI_CALLBACK_HOST ?? 'localhost';\n" }, []],
  ['vendored banner is skipped', { 'src/vendored.ts': `${vendoredBanner}${longFunction(60)}` }, []],
  ['justified exemption is a note', { 'src/exempt.ts': `// agents-compliance-ignore parameter-mutation: pi persists the field this write sets\n${writeFunction}` }, []],
  ['exemption without a reason fails', { 'src/blank.ts': `// agents-compliance-ignore parameter-mutation: short\n${writeFunction}` }, ['empty-exemption']],
  ['cli script console call is not a violation', { 'scripts/tool.mjs': "console.log('reporting');\n" }, []],
  ['cli script print is not a violation', { 'scripts/tool.py': pythonCli }, []],
  ['library print is a violation', { 'src/tool.py': pythonLibrary }, ['print-statement']],
];

async function fixture(overrides) {
  const directory = await mkdtemp(join(tmpdir(), 'agents-compliance-'));
  for (const [path, body] of Object.entries({ ...clean, ...overrides })) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), body);
  }
  return directory;
}

for (const [name, overrides, expected] of cases) {
  const directory = await fixture(overrides);
  try {
    const violations = (await audit(directory)).filter((item) => item.severity === 'violation');
    const rules = [...new Set(violations.map((item) => item.rule))].toSorted();
    assert.deepEqual(rules, [...expected].toSorted(), `${name}: ${JSON.stringify(violations)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

closeTypeScriptSources();
process.stdout.write(`check-agents-compliance self-test: ${cases.length} fixtures behaved as expected.\n`);
