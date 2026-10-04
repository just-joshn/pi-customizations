import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { buildTheme, checkParity, UPSTREAM_SHA256, type UpstreamDocument } from '../parity/theme.ts';
import { formatJSON, parseOriginalSource, readPinnedSource } from '../parity/upstream.ts';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');
const artifactPath = join(packageRoot, 'upstream', 'OneDark-Pro-flat.json');
const provenancePath = join(packageRoot, 'upstream', 'provenance.json');
const source = readPinnedSource(packageRoot);
const input = {
  ...source,
  rows: [],
  schema: { required: [], optional: [], exportProps: [] },
  committed: buildTheme(JSON.parse(source.upstreamText) as UpstreamDocument, []),
  themeLabel: 'fixture',
};

function independentFormat(text: string, path: string): string {
  return execFileSync(join(repositoryRoot, 'node_modules', '.bin', 'biome'), ['format', '--stdin-file-path', path], { cwd: repositoryRoot, input: text, encoding: 'utf8' });
}

test('the authentic original retains its byte count and published pin', () => {
  expect(Buffer.byteLength(source.upstreamText)).toBe(63665);
  expect(createHash('sha256').update(source.upstreamText).digest('hex')).toBe(UPSTREAM_SHA256);
});

test('shared Biome reproduces the exact artifact from the authentic original', () => {
  expect(source.upstreamArtifact.text).toBe(independentFormat(source.upstreamText, artifactPath));
  expect(source.upstreamArtifact.policyFormattedText).toBe(source.upstreamArtifact.text);
  expect(JSON.parse(source.upstreamArtifact.text)).toEqual(JSON.parse(source.upstreamText));
  expect(checkParity(input)).toEqual([]);
});

test('formatting the provenance envelope retains every original source byte', () => {
  const formatted = independentFormat(readFileSync(provenancePath, 'utf8'), provenancePath);
  expect(parseOriginalSource(formatted)).toBe(source.upstreamText);
});

test('an unmapped semantic change in the formatted artifact fails parity', () => {
  const text = source.upstreamArtifact.text.replace('"name": "One Dark Pro"', '"name": "tampered"');
  expect(text).not.toBe(source.upstreamArtifact.text);
  expect(checkParity({ ...input, upstreamArtifact: { ...source.upstreamArtifact, text } })).toEqual(['upstream artifact differs from shared Biome formatting of the pinned original source']);
});

test('artifact whitespace drift is rejected even when Biome normalizes it away', () => {
  const text = `${source.upstreamArtifact.text} `;
  expect(formatJSON(text, artifactPath)).toBe(source.upstreamArtifact.text);
  expect(checkParity({ ...input, upstreamArtifact: { ...source.upstreamArtifact, text } })).toEqual(['upstream artifact differs from shared Biome formatting of the pinned original source']);
});

test('original whitespace drift is still rejected by the authentic pin', () => {
  const problems = checkParity({ ...input, upstreamText: `${source.upstreamText} ` });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('upstream file sha256 is');
});

test.for(['null', '[]', '{}', '{"originalSource":42}', '{"originalSource":null}'])('rejects invalid provenance %s', (text) => {
  expect(() => parseOriginalSource(text)).toThrow('upstream provenance must contain an originalSource string');
});

test('rejects malformed provenance JSON', () => {
  expect(() => parseOriginalSource('{')).toThrow(SyntaxError);
});

test('allows an empty source at the parser boundary but rejects its pin', () => {
  expect(parseOriginalSource('{"originalSource":""}')).toBe('');
  expect(checkParity({ ...input, upstreamText: '' })[0]).toContain('upstream file sha256 is');
});

test('the Biome boundary fails closed on invalid JSON', () => {
  expect(() => formatJSON('{', artifactPath)).toThrow();
});

test('reads the caller package artifacts rather than a hidden canonical copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-source-'));
  try {
    mkdirSync(join(root, 'upstream'));
    writeFileSync(join(root, 'upstream', 'provenance.json'), readFileSync(provenancePath));
    writeFileSync(join(root, 'upstream', 'OneDark-Pro-flat.json'), '{}\n');
    const actual = readPinnedSource(root);
    expect(actual.upstreamText).toBe(source.upstreamText);
    expect(actual.upstreamArtifact.text).toBe('{}\n');
    expect(actual.upstreamArtifact.policyFormattedText).toBe(independentFormat(source.upstreamText, join(root, 'upstream', 'OneDark-Pro-flat.json')));
    expect(checkParity({ ...input, ...actual })).toEqual(['upstream artifact differs from shared Biome formatting of the pinned original source']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
