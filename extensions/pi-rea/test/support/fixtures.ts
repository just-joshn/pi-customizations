import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../../../../parity/pi-rea/fixtures/', import.meta.url));

export const fixturePath = (relative: string): string => `${FIXTURES}${relative}`;

export const fixtureSha256 = (relative: string): string =>
  createHash('sha256')
    .update(readFileSync(fixturePath(relative)))
    .digest('hex');

export const fixtureCdhash = (relative: string): string => {
  const result = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', fixturePath(relative)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`codesign failed: ${result.stderr}`);
  const match = /^CDHash=([a-f0-9]+)$/m.exec(result.stderr);
  if (!match?.[1]) throw new Error('codesign did not report a CDHash');
  return match[1];
};

export const readFixture = <T>(relative: string): T => JSON.parse(readFileSync(fixturePath(relative), 'utf8')) as T;

export interface CapturedCall {
  readonly request: { readonly name: string; readonly arguments: Record<string, unknown> };
  readonly response: {
    readonly result?: {
      readonly content?: readonly { readonly text?: string }[];
      readonly structuredContent?: unknown;
      readonly isError?: boolean;
    };
    readonly error?: { readonly message: string };
  };
}

export const capture = (pass: string, name: string): CapturedCall => readFixture<CapturedCall>(`captures/${pass}/${name}.json`);

export const referenceSessionReport = (): Record<string, unknown> => {
  const measured = readFileSync(new URL('../../../../parity/pi-rea/rea-6.8.0-binary_session.json', import.meta.url), 'utf8');
  const structured = (JSON.parse(measured) as { result: { structuredContent: { result: Record<string, unknown> } } }).result.structuredContent;
  return structured.result;
};

export const referenceTools = (): {
  tools: readonly {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    annotations: Record<string, boolean>;
  }[];
} => readFixture('tools-list.json');
