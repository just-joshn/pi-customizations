import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { cancelled, targetUnavailable } from '../contract/errors.ts';

export interface ArtifactIdentity {
  readonly path: string;
  readonly format: string;
  readonly kind: 'executable' | 'archive' | 'shared-library' | 'object';
  readonly sha256: string;
  readonly architecture: string | null;
}

const MACH_O_ARCHITECTURES = new Map<number, string>([
  [0x0000_0007, 'x86'],
  [0x0000_000c, 'arm'],
  [0x0000_0012, 'ppc'],
  [0x0000_0018, 'ppc64'],
  [0x0100_0007, 'x86_64'],
  [0x0100_000c, 'arm64'],
]);

const ELF_MACHINES = new Map<number, string>([
  [0x03, 'x86'],
  [0x3e, 'x86_64'],
  [0x28, 'arm'],
  [0xb7, 'arm64'],
  [0x08, 'mips'],
  [0x14, 'ppc'],
  [0x15, 'ppc64'],
  [0x16, 's390x'],
  [0xf3, 'riscv'],
]);

const MAGIC_BYTES = 4096;

const looksLikeUniversalBinary = (header: Buffer, bigEndian: boolean): boolean => {
  if (header.length < 8) return false;
  const count = bigEndian ? header.readUInt32BE(4) : header.readUInt32LE(4);
  if (count < 1 || count > 32) return false;
  const cpu = bigEndian ? header.readUInt32BE(8) : header.readUInt32LE(8);
  return MACH_O_ARCHITECTURES.has(cpu);
};

const fatArchitectures = (header: Buffer, bigEndian: boolean): number[] => {
  const count = bigEndian ? header.readUInt32BE(4) : header.readUInt32LE(4);
  const slices: number[] = [];
  for (let index = 0; index < count && index < 32; index += 1) {
    const offset = 8 + index * 20;
    if (offset + 4 > header.length) break;
    slices.push(bigEndian ? header.readUInt32BE(offset) : header.readUInt32LE(offset));
  }
  return slices;
};

type Detected = { readonly format: string; readonly architecture: string | null; readonly kind: ArtifactIdentity['kind'] };

const formatOf = (magic: Buffer): Detected | undefined => {
  const be = magic.readUInt32BE(0);
  const le = magic.readUInt32LE(0);
  if (le === 0xfeedfacf || be === 0xfeedfacf || le === 0xfeedface || be === 0xfeedface) {
    const cpu = be === 0xfeedfacf || be === 0xfeedface ? magic.readUInt32BE(4) : magic.readUInt32LE(4);
    return { format: 'mach-o', architecture: MACH_O_ARCHITECTURES.get(cpu) ?? null, kind: 'executable' };
  }
  if ((be === 0xcafebabe || le === 0xcafebabe) && looksLikeUniversalBinary(magic, be === 0xcafebabe)) {
    const host = process.arch === 'arm64' ? 0x0100000c : process.arch === 'x64' ? 0x01000007 : undefined;
    const slices = fatArchitectures(magic, be === 0xcafebabe);
    const chosen = slices.find((cpu) => cpu === host) ?? (slices.length === 1 ? slices[0] : undefined);
    return { format: 'mach-o', architecture: chosen === undefined ? null : (MACH_O_ARCHITECTURES.get(chosen) ?? null), kind: 'executable' };
  }
  if (magic.length >= 20 && magic.subarray(0, 4).toString('latin1') === '\u007fELF') {
    const type = magic.readUInt16LE(16);
    return {
      format: 'elf',
      architecture: ELF_MACHINES.get(magic.readUInt16LE(18)) ?? null,
      kind: type === 1 ? 'object' : type === 3 ? 'shared-library' : 'executable',
    };
  }
  if (magic.subarray(0, 2).toString('latin1') === 'MZ') return { format: 'pe', architecture: null, kind: 'executable' };
  if (le === 0x04034b50 || le === 0x08074b50 || le === 0x06054b50) return { format: 'zip', architecture: null, kind: 'archive' };
  return undefined;
};

export interface ArtifactPathFacts {
  readonly resolvedPath: string;
  readonly pathKind: 'file' | 'directory';
}

const resolveTarget = (path: string, cwd: string): string => (isAbsolute(path) ? path : resolve(cwd, path));

export const inspectArtifactPath = async (path: string, cwd: string = process.cwd()): Promise<ArtifactPathFacts> => {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(resolveTarget(path, cwd));
  } catch (error) {
    throw targetUnavailable(`Cannot open artifact: target does not exist or a path component is not a directory: ${(error as Error).message}. Check that the path exists, is readable, and points to a supported file.`, {
      path,
      reason: `target does not exist or a path component is not a directory: ${(error as Error).message}`,
    });
  }
  const stats = await stat(resolvedPath);
  if (stats.isDirectory()) return { resolvedPath, pathKind: 'directory' };
  if (!stats.isFile()) {
    throw targetUnavailable('open_binary accepts regular files only. This target is not a regular file.', {
      path: resolvedPath,
      reason: 'not a regular file',
    });
  }
  return { resolvedPath, pathKind: 'file' };
};

export const identifyArtifact = async (path: string, options: { readonly cwd?: string; readonly signal?: AbortSignal } = {}): Promise<ArtifactIdentity> => {
  const { resolvedPath, pathKind } = await inspectArtifactPath(path, options.cwd ?? process.cwd());
  if (pathKind === 'directory') {
    throw targetUnavailable('open_binary accepts files and macOS app bundles. This target is a directory; JavaScript/Electron application directories can be analyzed directly with analyze_javascript_application.', {
      path: resolvedPath,
      reason: 'this opening route requires a file or app bundle',
      constraint: 'directory_requires_file',
    });
  }
  const handle = await open(resolvedPath, 'r');
  try {
    const header = Buffer.alloc(MAGIC_BYTES);
    const { bytesRead } = await handle.read(header, 0, MAGIC_BYTES, 0);
    const magic = header.subarray(0, bytesRead);
    const detected = magic.length >= 4 ? formatOf(magic) : undefined;
    if (detected === undefined) {
      throw targetUnavailable('Cannot open artifact: unsupported binary format. Check that the path exists, is readable, and points to a supported file.', { path: resolvedPath, reason: 'unsupported binary format' });
    }
    const hash = createHash('sha256');
    const chunk = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      if (options.signal?.aborted === true) throw cancelled('Hashing the target was cancelled.');
      const { bytesRead: read } = await handle.read(chunk, 0, chunk.length, position);
      if (read === 0) break;
      hash.update(chunk.subarray(0, read));
      position += read;
    }
    return {
      path: resolvedPath,
      format: detected.format,
      kind: detected.kind,
      sha256: hash.digest('hex'),
      architecture: detected.architecture,
    };
  } finally {
    await handle.close();
  }
};
