import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHIPPED = ['src', 'schemas', 'skills', 'package.json'];

const walk = (path: string): string[] => {
  const stats = statSync(path);
  if (stats.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
};

const shippedFiles = SHIPPED.flatMap((entry) => walk(join(ROOT, entry)));

const read = (path: string): string => readFileSync(path, 'utf8');

test('KERN-019: no shipped file spawns, downloads or installs the reference', () => {
  const forbidden = [/\bnpx\b/, /\bbunx\b/, /npm install/, /rea-agents@/, /--mcp\b/, /@modelcontextprotocol/, /registerMcpServer/, /fetch\(/, /node:https?/];
  for (const file of shippedFiles) {
    const text = read(file);
    for (const pattern of forbidden) {
      expect(text, `${file} matches ${String(pattern)}`).not.toMatch(pattern);
    }
  }
});

test('KERN-002: the package declares no reference dependency', () => {
  const manifest = JSON.parse(read(join(ROOT, 'package.json'))) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    files?: string[];
  };
  const declared = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
  expect(Object.keys(declared).filter((name) => name.includes('rea-agents'))).toStrictEqual([]);
  expect(manifest.files).toContain('schemas');
});

test('KERN-002: the extension only imports Pi, typebox, Babel parser, and relative modules', () => {
  const specifiers = (source: string): string[] => [...source.matchAll(/(?:^|[\s;])(?:import|export)\s(?:[^'"]*?\sfrom\s)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((match) => match[1] ?? match[2] ?? '');
  const sources = shippedFiles.filter((path) => path.endsWith('.ts') || path.endsWith('.mjs'));
  for (const file of sources) {
    for (const specifier of specifiers(read(file))) {
      const allowed = specifier.startsWith('.') || specifier.startsWith('node:') || specifier === '@earendil-works/pi-coding-agent' || specifier === '@earendil-works/pi-ai' || specifier === '@babel/parser';
      expect(allowed, `${file} imports ${specifier}`).toBe(true);
    }
  }
});

test('KERN-002: the shipped contract names the interface but carries no reference text', () => {
  const contract = read(join(ROOT, 'schemas/tool-contracts.json'));
  expect(contract).toContain('rea-agents 6.8.0');
  expect(contract).toContain('No REA prose');
  for (const marker of ['morluto', 'hop://', 'hopperapp', 'REA_', 'GHIDRA_INSTALL_DIR', 'REA_TSHARK_COMMAND', 'remediation']) {
    expect(contract).not.toContain(marker);
  }
});

test("KERN-019: the workflow skill is pi-rea's own text", () => {
  const skill = read(join(ROOT, 'skills/reverse-engineer-anything/SKILL.md'));
  expect(skill).toContain('pi-rea');
  expect(skill).not.toContain('morluto');
  expect(skill).not.toContain('metadata:\n  version:');
});
