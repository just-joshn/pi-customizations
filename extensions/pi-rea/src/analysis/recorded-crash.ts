
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest, unsupportedTarget } from '../contract/errors.ts';

export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_SEGMENTS = 256;
export const DEFAULT_MAX_NOTES = 64;

export interface RecordedCrashInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly format: 'elf64-core';
  readonly byte_order: 'little';
  readonly machine: number;
  readonly machine_name: 'x86_64' | 'aarch64' | 'unknown';
  readonly type: number;
  readonly segments: readonly {
    readonly index: number;
    readonly type: number;
    readonly flags: number;
    readonly offset: number;
    readonly virt_addr: string;
    readonly phys_addr: string;
    readonly file_size: number;
    readonly mem_size: number;
    readonly alignment: number;
  }[];
  readonly notes: readonly {
    readonly index: number;
    readonly owner: string;
    readonly type: number;
    readonly type_name: string;
    readonly location: { readonly offset: number; readonly bytes: number };
    readonly descriptor_sha256: string;
    readonly prstatus: Record<string, unknown> | null;
    readonly siginfo: Record<string, unknown> | null;
  }[];
  readonly threads: readonly Record<string, unknown>[];
  readonly coverage: { readonly status: 'complete' | 'partial'; readonly examined_segments: number; readonly examined_notes: number };
  readonly limitations: readonly string[];
}

const LIMITATIONS = [
  'This workflow inspects a supplied Linux ELF core only; it does not launch the target or attach to a live PID.',
  'Historical PID values are recorded metadata; current process identity and debugger mappings remain unknown without explicit BYO configuration.',
  'Note coverage beyond the examined PT_NOTE descriptors is not established.',
] as const;

const PT_LOAD = 1;
const PT_NOTE = 4;
const ET_CORE = 4;
const EM_X86_64 = 62;
const EM_AARCH64 = 183;
const NT_PRSTATUS = 1;
const NT_SIGINFO = 0x53494749;

const inputError = (path: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_recorded_crash',
    issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${detail}` }],
  });

const machineName = (machine: number): RecordedCrashInspection['machine_name'] => {
  if (machine === EM_X86_64) return 'x86_64';
  if (machine === EM_AARCH64) return 'aarch64';
  return 'unknown';
};

const noteTypeName = (owner: string, type: number): string => {
  if (owner === 'CORE' && type === NT_PRSTATUS) return 'NT_PRSTATUS';
  if (owner === 'CORE' && type === NT_SIGINFO) return 'NT_SIGINFO';
  if (owner === 'CORE' && type === 3) return 'NT_PRPSINFO';
  if (owner === 'CORE' && type === 4) return 'NT_TASKSTRUCT';
  if (owner === 'CORE' && type === 5) return 'NT_AUXV';
  return `note_${type}`;
};

const parsePrstatus = (desc: Buffer, machine: number): Record<string, unknown> | null => {
  // Linux elf_prstatus layout varies; record bounded observed fields only.
  if (desc.length < 32) return null;
  const signal = desc.readInt32LE(12);
  const pid = desc.readInt32LE(24);
  const ppid = desc.readInt32LE(28);
  const registers: Record<string, string> = {};
  // x86_64 user_regs_struct starts after pr_reg offset 112 on many kernels; keep raw window digest instead of inventing names when short.
  if (machine === EM_X86_64 && desc.length >= 112 + 27 * 8) {
    const names = [
      'r15',
      'r14',
      'r13',
      'r12',
      'rbp',
      'rbx',
      'r11',
      'r10',
      'r9',
      'r8',
      'rax',
      'rcx',
      'rdx',
      'rsi',
      'rdi',
      'orig_rax',
      'rip',
      'cs',
      'eflags',
      'rsp',
      'ss',
    ];
    for (const [index, name] of names.entries()) {
      const value = desc.readBigUInt64LE(112 + index * 8);
      registers[name] = `0x${value.toString(16)}`;
    }
  }
  return {
    signal,
    pid,
    ppid,
    registers: Object.keys(registers).length > 0 ? registers : null,
    descriptor_bytes: desc.length,
  };
};

const parseSiginfo = (desc: Buffer): Record<string, unknown> | null => {
  if (desc.length < 16) return null;
  return {
    si_signo: desc.readInt32LE(0),
    si_errno: desc.readInt32LE(4),
    si_code: desc.readInt32LE(8),
    descriptor_bytes: desc.length,
  };
};

const parseNotes = (
  bytes: Buffer,
  offset: number,
  size: number,
  machine: number,
  maxNotes: number,
): { readonly notes: RecordedCrashInspection['notes']; readonly threads: Record<string, unknown>[] } => {
  const notes: RecordedCrashInspection['notes'][number][] = [];
  const threads: Record<string, unknown>[] = [];
  let cursor = offset;
  const end = Math.min(bytes.length, offset + size);
  let index = 0;
  while (cursor + 12 <= end && notes.length < maxNotes) {
    const namesz = bytes.readUInt32LE(cursor);
    const descsz = bytes.readUInt32LE(cursor + 4);
    const type = bytes.readUInt32LE(cursor + 8);
    const nameStart = cursor + 12;
    const nameEnd = nameStart + namesz;
    const namePad = (4 - (namesz % 4)) % 4;
    const descStart = nameEnd + namePad;
    const descEnd = descStart + descsz;
    const descPad = (4 - (descsz % 4)) % 4;
    if (descEnd > end) break;
    const ownerRaw = bytes.subarray(nameStart, nameEnd);
    const owner = ownerRaw.toString('utf8').replace(/\0+$/, '');
    const desc = bytes.subarray(descStart, descEnd);
    const typeName = noteTypeName(owner, type);
    const prstatus = owner === 'CORE' && type === NT_PRSTATUS ? parsePrstatus(desc, machine) : null;
    const siginfo = owner === 'CORE' && type === NT_SIGINFO ? parseSiginfo(desc) : null;
    notes.push({
      index,
      owner,
      type,
      type_name: typeName,
      location: { offset: cursor, bytes: descEnd + descPad - cursor },
      descriptor_sha256: createHash('sha256').update(desc).digest('hex'),
      prstatus,
      siginfo,
    });
    if (prstatus !== null) {
      threads.push({
        index: threads.length,
        note_index: index,
        signal: prstatus['signal'],
        pid: prstatus['pid'],
        registers: prstatus['registers'],
      });
    }
    cursor = descEnd + descPad;
    index += 1;
  }
  return { notes, threads };
};

export const inspectRecordedCrashFromPath = async (
  path: string,
  options: {
    readonly cwd?: string;
    readonly maxFileBytes?: number;
    readonly maxSegments?: number;
    readonly maxNotes?: number;
    readonly includeDebuggerContext?: boolean;
  } = {},
): Promise<{ readonly record: RecordedCrashInspection; readonly path: string; readonly resolvedPath: string }> => {
  if (typeof path !== 'string' || path.length === 0) {
    throw invalidRequest('inspect_recorded_crash requires path.', { operation: 'inspect_recorded_crash', parameter: 'path' });
  }
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let canonical = resolvedPath;
  try {
    canonical = await realpath(resolvedPath);
  } catch (error) {
    throw inputError(path, `it could not be resolved (${(error as Error).message})`);
  }
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const stats = await stat(canonical);
  if (!stats.isFile()) throw inputError(path, 'it is not a regular file');
  if (stats.size > maxFileBytes) {
    throw unsupportedTarget(`Core file exceeds max_file_bytes=${maxFileBytes}.`, { path, bytes: stats.size });
  }
  const bytes = await readFile(canonical);
  if (bytes.length < 64 || bytes.toString('ascii', 0, 4) !== '\u007fELF') {
    throw unsupportedTarget('inspect_recorded_crash accepts Linux ELF64 little-endian cores only.', { path, reason: 'not_elf' });
  }
  const clazz = bytes[4];
  const data = bytes[5];
  if (clazz !== 2 || data !== 1) {
    throw unsupportedTarget('inspect_recorded_crash accepts Linux ELF64 little-endian cores only.', {
      path,
      reason: 'unsupported_elf_class_or_endian',
    });
  }
  const type = bytes.readUInt16LE(16);
  const machine = bytes.readUInt16LE(18);
  if (type !== ET_CORE) {
    throw unsupportedTarget('inspect_recorded_crash requires ELF type ET_CORE.', { path, type });
  }
  if (machine !== EM_X86_64 && machine !== EM_AARCH64) {
    throw unsupportedTarget('inspect_recorded_crash accepts amd64 or AArch64 cores only.', { path, machine });
  }

  const phoff = Number(bytes.readBigUInt64LE(32));
  const phentsize = bytes.readUInt16LE(54);
  const phnum = bytes.readUInt16LE(56);
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const maxNotes = options.maxNotes ?? DEFAULT_MAX_NOTES;

  const segments: RecordedCrashInspection['segments'][number][] = [];
  const allNotes: RecordedCrashInspection['notes'][number][] = [];
  const allThreads: Record<string, unknown>[] = [];

  for (let index = 0; index < phnum && segments.length < maxSegments; index += 1) {
    const offset = phoff + index * phentsize;
    if (offset + phentsize > bytes.length) break;
    const pType = bytes.readUInt32LE(offset);
    const flags = bytes.readUInt32LE(offset + 4);
    const pOffset = Number(bytes.readBigUInt64LE(offset + 8));
    const vaddr = bytes.readBigUInt64LE(offset + 16);
    const paddr = bytes.readBigUInt64LE(offset + 24);
    const filesz = Number(bytes.readBigUInt64LE(offset + 32));
    const memsz = Number(bytes.readBigUInt64LE(offset + 40));
    const align = Number(bytes.readBigUInt64LE(offset + 48));
    if (pType === PT_LOAD) {
      segments.push({
        index,
        type: pType,
        flags,
        offset: pOffset,
        virt_addr: `0x${vaddr.toString(16)}`,
        phys_addr: `0x${paddr.toString(16)}`,
        file_size: filesz,
        mem_size: memsz,
        alignment: align,
      });
    } else if (pType === PT_NOTE) {
      const parsed = parseNotes(bytes, pOffset, filesz, machine, maxNotes - allNotes.length);
      for (const note of parsed.notes) allNotes.push({ ...note, index: allNotes.length });
      allThreads.push(...parsed.threads);
    }
  }

  const limitations: string[] = [...LIMITATIONS];
  if (options.includeDebuggerContext === true) {
    limitations.push(
      'include_debugger_context was requested but BYO GDB/pwndbg mapping is not configured in this port; mapping candidates remain unknown.',
    );
  }

  return {
    path,
    resolvedPath: canonical,
    record: {
      artifact: {
        path: canonical,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
      },
      format: 'elf64-core',
      byte_order: 'little',
      machine,
      machine_name: machineName(machine),
      type,
      segments,
      notes: allNotes,
      threads: allThreads,
      coverage: {
        status: phnum > maxSegments || allNotes.length >= maxNotes ? 'partial' : 'complete',
        examined_segments: segments.length,
        examined_notes: allNotes.length,
      },
      limitations,
    },
  };
};

export const minimalElf64CoreFixture = (): Buffer => {
  const buf = Buffer.alloc(128);
  buf.write('\u007fELF', 0, 'ascii');
  buf[4] = 2;
  buf[5] = 1;
  buf[6] = 1;
  buf.writeUInt16LE(ET_CORE, 16);
  buf.writeUInt16LE(EM_X86_64, 18);
  buf.writeUInt32LE(1, 20);
  buf.writeBigUInt64LE(0n, 24);
  buf.writeBigUInt64LE(64n, 32);
  buf.writeBigUInt64LE(0n, 40);
  buf.writeUInt32LE(0, 48);
  buf.writeUInt16LE(64, 52);
  buf.writeUInt16LE(56, 54);
  buf.writeUInt16LE(1, 56);
  buf.writeUInt16LE(0, 58);
  buf.writeUInt16LE(0, 60);
  buf.writeUInt16LE(0, 62);
  // PT_NOTE empty
  buf.writeUInt32LE(PT_NOTE, 64);
  buf.writeUInt32LE(0, 68);
  buf.writeBigUInt64LE(120n, 72);
  buf.writeBigUInt64LE(0n, 80);
  buf.writeBigUInt64LE(0n, 88);
  buf.writeBigUInt64LE(0n, 96);
  buf.writeBigUInt64LE(0n, 104);
  buf.writeBigUInt64LE(8n, 112);
  return buf;
};
