import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { lineAt } from '../../adapters/dependencies.ts';
import { applySpans, type Span } from '../../adapters/skill-transforms.ts';
import { PKG } from './helpers.ts';

type ManifestSpan = Span & { output: string };
const manifest = JSON.parse(readFileSync(join(PKG, 'generated/transformation-manifest.json'), 'utf8')) as { spans: ManifestSpan[] };

test('every manifest span re-applies cleanly to the vendored source and reproduces the generated file', () => {
  const bySource = new Map<string, ManifestSpan[]>();
  for (const span of manifest.spans) bySource.set(span.file, [...(bySource.get(span.file) ?? []), span]);
  expect(bySource.size).toBeGreaterThan(40);
  for (const [source, spans] of bySource) {
    const original = readFileSync(join(PKG, source), 'utf8');
    for (const span of spans) {
      expect(original.slice(span.offset[0], span.offset[1])).toBe(span.original);
      expect([lineAt(original, span.offset[0]), lineAt(original, span.offset[1] - 1)]).toEqual(span.lines);
    }
    expect(applySpans(original, spans)).toBe(readFileSync(join(PKG, spans[0]?.output ?? ''), 'utf8'));
  }
});
