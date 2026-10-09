#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testPath = join(root, 'test', 'slugify.test.js');
const outPath = join(root, 'evidence', 'verify-out.txt');
const EXPECTED = 'hello-world';
const INPUT = 'Hello, World!';

function analyzeTestSource(src) {
  const callsSubject = /slugify\s*\(\s*['"`]Hello,\s*World!['"`]\s*\)/.test(src);
  const hasHelloWorldLiteral = /['"`]hello-world['"`]/.test(src);
  const hasAssertCall =
    /assert\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\s*\(/.test(src) ||
    /\.to(?:Be|Equal|StrictEqual)\s*\(/.test(src);
  const literalAssert = hasHelloWorldLiteral && hasAssertCall;
  const weakOnly =
    /doesNotThrow|not\.toThrow|toBeDefined|toBeTruthy|assert\.ok\s*\(\s*slugify\s*\)/.test(src) &&
    !literalAssert;
  return { callsSubject, literalAssert, weakOnly };
}

async function subjectOk() {
  const { slugify } = await import(
    `${pathToFileURL(join(root, 'src', 'slugify.js')).href}?t=${Date.now()}`
  );
  return slugify(INPUT) === EXPECTED;
}

const src = await readFile(testPath, 'utf8');
const shape = analyzeTestSource(src);
const productOk = await subjectOk();
const run = spawnSync(process.execPath, ['--test', testPath], {
  cwd: root,
  encoding: 'utf8',
});
const testRunOk = run.status === 0;

const stubProbe = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
import assert from 'node:assert/strict';
const slugify = () => undefined;
let failed = false;
try {
  assert.equal(slugify(${JSON.stringify(INPUT)}), ${JSON.stringify(EXPECTED)});
} catch {
  failed = true;
}
process.exit(failed ? 0 : 1);
`,
  ],
  { encoding: 'utf8' },
);
const undefinedWouldFail = stubProbe.status === 0;

const behaviorOk =
  shape.callsSubject && shape.literalAssert && !shape.weakOnly && undefinedWouldFail;
const ok = productOk && testRunOk && behaviorOk;

const line = ok
  ? `TEST-OK input=${JSON.stringify(INPUT)} expected=${EXPECTED}`
  : `TEST-FAIL product=${productOk} testRun=${testRunOk} callsSubject=${shape.callsSubject} literalAssert=${shape.literalAssert} weakOnly=${shape.weakOnly} undefinedWouldFail=${undefinedWouldFail} status=${run.status}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
process.exit(ok ? 0 : 1);
