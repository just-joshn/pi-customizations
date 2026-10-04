import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface UpstreamArtifact {
  readonly text: string;
  readonly policyFormattedText: string;
}

export function parseOriginalSource(text: string): string {
  const provenance: unknown = JSON.parse(text);
  if (typeof provenance !== 'object' || provenance === null || !('originalSource' in provenance) || typeof provenance.originalSource !== 'string') {
    throw new Error('upstream provenance must contain an originalSource string');
  }
  return provenance.originalSource;
}

export function formatJSON(text: string, filePath: string): string {
  return execFileSync(join(repositoryRoot, 'node_modules', '.bin', 'biome'), ['format', '--stdin-file-path', filePath], {
    cwd: repositoryRoot,
    input: text,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function readPinnedSource(packageRoot: string): { readonly upstreamText: string; readonly upstreamArtifact: UpstreamArtifact } {
  const upstreamPath = join(packageRoot, 'upstream', 'OneDark-Pro-flat.json');
  const upstreamText = parseOriginalSource(readFileSync(join(packageRoot, 'upstream', 'provenance.json'), 'utf8'));
  return {
    upstreamText,
    upstreamArtifact: {
      text: readFileSync(upstreamPath, 'utf8'),
      policyFormattedText: formatJSON(upstreamText, upstreamPath),
    },
  };
}
