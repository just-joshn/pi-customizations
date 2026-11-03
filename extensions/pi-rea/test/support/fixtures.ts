import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../../../../parity/pi-rea/fixtures/', import.meta.url));

export const fixturePath = (relative: string): string => `${FIXTURES}${relative}`;

export const fixtureSha256 = (relative: string): string =>
  createHash('sha256')
    .update(readFileSync(fixturePath(relative)))
    .digest('hex');

const CODESIGN = '/usr/bin/codesign';
const LC_CODE_SIGNATURE = 0x1d;
const CODE_DIRECTORY_SLOTS = [0x1000, 0x1001, 0x1002, 0x1003, 0x1004, 0];
const HASH_TYPES: Readonly<Record<number, string>> = { 1: 'sha1', 2: 'sha256', 3: 'sha256', 4: 'sha384' };

const cdhashFromSignature = (bytes: Buffer): string => {
  const commandCount = bytes.readUInt32LE(16);
  let cursor = 32;
  for (let index = 0; index < commandCount; index += 1) {
    const command = bytes.readUInt32LE(cursor);
    const size = bytes.readUInt32LE(cursor + 4);
    if (command === LC_CODE_SIGNATURE) {
      const superBlob = bytes.subarray(bytes.readUInt32LE(cursor + 8));
      const blobCount = superBlob.readUInt32BE(8);
      const offsets = new Map<number, number>();
      for (let blob = 0; blob < blobCount; blob += 1) offsets.set(superBlob.readUInt32BE(12 + blob * 8), superBlob.readUInt32BE(16 + blob * 8));
      for (const slot of CODE_DIRECTORY_SLOTS) {
        const offset = offsets.get(slot);
        if (offset === undefined) continue;
        const directory = superBlob.subarray(offset, offset + superBlob.readUInt32BE(offset + 4));
        const algorithm = HASH_TYPES[directory.readUInt8(37)];
        if (algorithm === undefined) continue;
        return createHash(algorithm).update(directory).digest('hex').slice(0, 40);
      }
    }
    cursor += size;
  }
  throw new Error('the Mach-O image carries no code directory');
};

export const fixtureCdhash = (relative: string): string => {
  if (!existsSync(CODESIGN)) return cdhashFromSignature(readFileSync(fixturePath(relative)));
  const result = spawnSync(CODESIGN, ['-d', '--verbose=4', fixturePath(relative)], { encoding: 'utf8' });
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
