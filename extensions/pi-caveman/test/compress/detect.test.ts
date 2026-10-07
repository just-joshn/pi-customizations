import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { detectFileType, shouldCompress } from '../../src/compress/detect.ts';

const DOCKERFILE_BODY = 'FROM node:20-bookworm\nWORKDIR /app\nCOPY package.json .\nRUN npm install\nCMD ["node", "index.js"]\n';
const MAKEFILE_BODY = 'all: build\n\nbuild:\n\tgo build -o bin/app ./cmd/app\n\nclean:\n\trm -rf bin\n';
const SHEBANG_BODY = '#!/usr/bin/env bash\nset -euo pipefail\necho "deploying"\n';
const PROSE_BODY =
  'This project collects notes about our deployment process.\n\nThe main goal is to keep the steps simple enough that anyone on the\nteam can run a release without asking for help. Start by reading the\noverview, then follow the checklist in order.\n';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'caveman-detect-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body, 'utf8');
  return p;
}

describe('detectFileType', () => {
  test('Dockerfile is code', () => {
    const p = write('Dockerfile', DOCKERFILE_BODY);
    expect(detectFileType(p)).toBe('code');
    expect(shouldCompress(p)).toBe(false);
  });

  test('Makefile is code', () => {
    const p = write('Makefile', MAKEFILE_BODY);
    expect(detectFileType(p)).toBe('code');
    expect(shouldCompress(p)).toBe(false);
  });

  test.each(['dockerfile', 'Containerfile', 'MAKEFILE', 'Jenkinsfile', 'Vagrantfile', 'Earthfile', 'Fastfile', 'Podfile'])('known name %s is code case-insensitively', (name) => {
    expect(detectFileType(write(name, 'irrelevant body\n'))).toBe('code');
  });

  test('CMakeLists.txt is code despite .txt', () => {
    const p = write('CMakeLists.txt', 'add_executable(app main.c)\n');
    expect(detectFileType(p)).toBe('code');
    expect(shouldCompress(p)).toBe(false);
  });

  test('shebang script is code', () => {
    const p = write('deploy', SHEBANG_BODY);
    expect(detectFileType(p)).toBe('code');
    expect(shouldCompress(p)).toBe(false);
  });

  test('extensionless prose is compressible', () => {
    const p = write('NOTES', PROSE_BODY);
    expect(detectFileType(p)).toBe('natural_language');
    expect(shouldCompress(p)).toBe(true);
  });

  test('markdown is compressible', () => {
    const p = write('README.md', PROSE_BODY);
    expect(detectFileType(p)).toBe('natural_language');
    expect(shouldCompress(p)).toBe(true);
  });

  test('cursor rule .mdc is natural language', () => {
    const p = write('caveman.mdc', `---\ndescription: Example rule\nalwaysApply: true\n---\n\n${PROSE_BODY}`);
    expect(detectFileType(p)).toBe('natural_language');
    expect(shouldCompress(p)).toBe(true);
  });

  test('extension classes and content heuristics', () => {
    expect(detectFileType('/x/a.json', '')).toBe('config');
    expect(detectFileType('/x/a.ts', '')).toBe('code');
    expect(detectFileType('/x/a.weird', 'prose')).toBe('unknown');
    expect(detectFileType('/x/.env', 'A=1')).toBe('natural_language');
    expect(detectFileType('/x/data', '{"a": 1}')).toBe('config');
    expect(detectFileType('/x/conf', 'name: x\nversion: 2\n')).toBe('config');
    expect(detectFileType('/x/script', 'import os\nconst x = 1\nprose here\n')).toBe('code');
  });

  test('backup files and missing files are not compressed', () => {
    expect(shouldCompress(write('task.original.md', PROSE_BODY))).toBe(false);
    expect(shouldCompress(join(dir, 'missing.md'))).toBe(false);
    expect(shouldCompress(dir)).toBe(false);
  });
});
