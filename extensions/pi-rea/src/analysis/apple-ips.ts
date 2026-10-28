
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const DEFAULT_MAX_FILE_BYTES = 1_048_576;
export const DEFAULT_MAX_THREADS = 256;
export const DEFAULT_MAX_FRAMES = 8192;
export const DEFAULT_MAX_IMAGES = 1024;
export const DEFAULT_MAX_REGISTERS = 16_384;
export const DEFAULT_MAX_INTEGER_TEXT_BYTES = 8_388_608;

export interface AppleIpsInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly metadata: {
    readonly bug_type: string;
    readonly timestamp: string | null;
    readonly os_version: string | null;
    readonly bundle_id: string | null;
    readonly incident_id: string | null;
    readonly name: string | null;
    readonly build_version: string | null;
    readonly platform: { readonly decimal: string; readonly hex: string | null } | null;
    readonly unlisted_keys: readonly string[];
  };
  readonly process: {
    readonly name: string | null;
    readonly path: string | null;
    readonly pid: { readonly decimal: string; readonly hex: string | null } | null;
    readonly parent: string | null;
    readonly parent_pid: { readonly decimal: string; readonly hex: string | null } | null;
    readonly cpu_type: string | null;
    readonly translated: boolean | null;
    readonly os_version: { readonly form: string; readonly text: string } | { readonly form: string; readonly train: string | null; readonly build: string | null; readonly release_type: string | null; readonly is_embedded: boolean | null; readonly unlisted_keys: readonly string[] } | null;
  };
  readonly exception: {
    readonly type: string | null;
    readonly signal: string | null;
    readonly subtype: string | null;
    readonly codes: string | null;
    readonly message: string | null;
    readonly unlisted_keys: readonly string[];
  } | null;
  readonly termination: {
    readonly namespace: string | null;
    readonly code: { readonly decimal: string; readonly hex: string | null } | null;
    readonly indicator: string | null;
    readonly flags: { readonly decimal: string; readonly hex: string | null } | null;
    readonly by_pid: { readonly decimal: string; readonly hex: string | null } | null;
    readonly by_proc: string | null;
    readonly reasons: readonly string[] | null;
    readonly unlisted_keys: readonly string[];
  } | null;
  readonly faulting_thread: number | null;
  readonly threads: readonly IpsThread[];
  readonly images: readonly IpsImage[];
  readonly classification: { readonly status: string; readonly matches: readonly { readonly rule: string; readonly fields: readonly { readonly name: string; readonly value: string }[] }[] } | null;
  readonly coverage: {
    readonly status: 'complete' | 'partial';
    readonly reason: string | null;
    readonly threads: number;
    readonly frames: number;
    readonly images: number;
    readonly registers: number;
    readonly type_mismatches: readonly unknown[];
  };
  readonly unlisted_body_keys: readonly string[];
  readonly limitations: readonly string[];
}

interface IpsThread {
  readonly index: number;
  readonly id: { readonly decimal: string; readonly hex: string | null } | null;
  readonly triggered: boolean | null;
  readonly name: string | null;
  readonly queue: string | null;
  readonly frames: readonly IpsFrame[];
  readonly state_flavor: string | null;
  readonly registers: readonly { readonly name: string; readonly value: { readonly decimal: string; readonly hex: string | null } }[];
}

interface IpsFrame {
  readonly thread_index: number;
  readonly frame_index: number;
  readonly image_index: number | null;
  readonly image_offset: { readonly decimal: string; readonly hex: string | null } | null;
  readonly runtime_address: { readonly decimal: string; readonly hex: string | null } | null;
  readonly role: 'faulting_instruction' | 'current_instruction' | 'return_address' | 'unknown';
  readonly inline: boolean | null;
  readonly recorded_symbol: string | null;
  readonly symbol_location: { readonly decimal: string; readonly hex: string | null } | null;
}

interface IpsImage {
  readonly index: number;
  readonly source: string | null;
  readonly source_meaning: string | null;
  readonly arch: string | null;
  readonly base: { readonly decimal: string; readonly hex: string | null } | null;
  readonly size: { readonly decimal: string; readonly hex: string | null } | null;
  readonly uuid: string | null;
  readonly uuid_unknown: boolean;
  readonly name: string | null;
  readonly path: string | null;
}

export const IPS_LIMITATIONS = [
  'Rows reproduce the selected .ips JSON; they do not establish that the process still exists or that a live kernel agrees with the recorded state.',
  'Opened Mach-O and dSYM UUID joins remain unobserved.',
  'Symbol names printed inside the report are recorded claims and are not verified.',
];

const SOURCE_MEANING: Record<string, string> = {
  P: 'process',
  S: 'shared_cache',
  C: 'shared_cache',
  B: 'kernel',
  T: 'kernel',
  K: 'kernel',
};

const KNOWN_META = new Set(['bug_type', 'timestamp', 'os_version', 'bundleID', 'incident_id', 'name', 'build_version', 'platform']);
const KNOWN_BODY = new Set([
  'procName',
  'procPath',
  'pid',
  'parentProc',
  'parentPid',
  'cpuType',
  'translated',
  'osVersion',
  'exception',
  'termination',
  'faultingThread',
  'threads',
  'usedImages',
  'bug_type',
  'isCorpse',
]);

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_apple_ips',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

const intField = (value: unknown): { decimal: string; hex: string | null } | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return { decimal: String(n), hex: `0x${BigInt(n).toString(16)}` };
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    try {
      const n = BigInt(value);
      return { decimal: value, hex: `0x${n.toString(16)}` };
    } catch {
      return null;
    }
  }
  return null;
};

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const classify = (body: Record<string, unknown>, exception: AppleIpsInspection['exception'], termination: AppleIpsInspection['termination']): AppleIpsInspection['classification'] => {
  const matches: { rule: string; fields: { name: string; value: string }[] }[] = [];
  const signal = exception?.signal ?? null;
  const indicator = termination?.indicator ?? null;
  const reasons = termination?.reasons ?? [];
  if (indicator === 'watchdog' || reasons.some((reason) => /watchdog/i.test(reason))) {
    matches.push({ rule: 'watchdog', fields: [{ name: 'termination.indicator', value: String(indicator) }] });
  }
  if (indicator === 'dead10cc' || reasons.some((reason) => /dead10cc/i.test(reason))) {
    matches.push({ rule: 'dead10cc', fields: [{ name: 'termination.indicator', value: String(indicator) }] });
  }
  if (indicator === 'thermal' || reasons.some((reason) => /thermal/i.test(reason))) {
    matches.push({ rule: 'thermal', fields: [{ name: 'termination.indicator', value: String(indicator) }] });
  }
  const codes = exception?.codes ?? '';
  if (/GUARD/i.test(String(exception?.type)) && /FILEDESCRIPTOR|FD/i.test(codes)) {
    matches.push({ rule: 'guarded_file_descriptor', fields: [{ name: 'exception.codes', value: codes }] });
  }
  if (/GUARD/i.test(String(exception?.type)) && /MACH_PORT|MACHPORT/i.test(codes)) {
    matches.push({ rule: 'guarded_mach_port', fields: [{ name: 'exception.codes', value: codes }] });
  }
  if (/PAC|POINTER.?AUTH|EXC_BAD_ACCESS/i.test(String(exception?.type)) && /CODE_17|PAC/i.test(codes + String(exception?.subtype))) {
    matches.push({ rule: 'possible_pointer_authentication_failure', fields: [{ name: 'exception.type', value: String(exception?.type) }] });
  }
  const text = JSON.stringify(body);
  if (/Library not loaded|dyld.*missing/i.test(text)) {
    matches.push({ rule: 'dyld_missing_library', fields: [{ name: 'body', value: 'dyld missing library marker' }] });
  }
  void signal;
  return { status: matches.length > 0 ? 'matched' : 'unclassified', matches };
};

export interface AppleIpsOptions {
  readonly maxFileBytes?: number;
  readonly maxThreads?: number;
  readonly maxFrames?: number;
  readonly maxImages?: number;
  readonly maxRegisters?: number;
  readonly cwd?: string;
}

export const inspectAppleIpsFromPath = async (
  path: string,
  options: AppleIpsOptions = {},
): Promise<{ record: AppleIpsInspection; path: string; resolvedPath: string }> => {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxThreads = options.maxThreads ?? DEFAULT_MAX_THREADS;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const maxRegisters = options.maxRegisters ?? DEFAULT_MAX_REGISTERS;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 2 || maxFileBytes > 16_777_216) {
    throw inputError(path, 'invalid_value', 'max_file_bytes must be an integer between 2 and 16777216.');
  }
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let text: string;
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
    text = bytes.toString('utf8');
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }
  if (bytes.length > maxFileBytes) throw inputError(path, 'invalid_value', `the report is ${bytes.length} bytes, more than the ${maxFileBytes} byte limit`);

  const newline = text.indexOf('\n');
  if (newline <= 0) throw inputError(path, 'invalid_format', 'an .ips report needs a first-line metadata object and a body.');
  let metadataRaw: unknown;
  let bodyRaw: unknown;
  try {
    metadataRaw = JSON.parse(text.slice(0, newline));
    bodyRaw = JSON.parse(text.slice(newline + 1));
  } catch {
    throw inputError(path, 'invalid_format', 'the .ips metadata or body is not valid JSON.');
  }
  const metadataObj = asRecord(metadataRaw);
  const body = asRecord(bodyRaw);
  if (metadataObj === null || body === null) throw inputError(path, 'invalid_format', 'the .ips metadata and body must be JSON objects.');
  const bugType = stringOrNull(metadataObj['bug_type']);
  if (bugType === null) throw inputError(path, 'invalid_format', 'metadata.bug_type must be a string.');

  const unlistedMeta = Object.keys(metadataObj).filter((key) => !KNOWN_META.has(key));
  const platformValue = metadataObj['platform'];
  const metadata = {
    bug_type: bugType,
    timestamp: stringOrNull(metadataObj['timestamp']),
    os_version: stringOrNull(metadataObj['os_version']),
    bundle_id: stringOrNull(metadataObj['bundleID']),
    incident_id: stringOrNull(metadataObj['incident_id']),
    name: stringOrNull(metadataObj['name']),
    build_version: stringOrNull(metadataObj['build_version']),
    platform: intField(platformValue) ?? (typeof platformValue === 'string' ? { decimal: platformValue, hex: null } : null),
    unlisted_keys: unlistedMeta,
  };

  const emptyProcess = {
    name: null,
    path: null,
    pid: null,
    parent: null,
    parent_pid: null,
    cpu_type: null,
    translated: null,
    os_version: null,
  };

  if (bugType !== '309') {
    return {
      path,
      resolvedPath,
      record: {
        artifact: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
        metadata,
        process: emptyProcess,
        exception: null,
        termination: null,
        faulting_thread: null,
        threads: [],
        images: [],
        classification: null,
        coverage: { status: 'complete', reason: `bug_type ${bugType} is not the crash body form 309`, threads: 0, frames: 0, images: 0, registers: 0, type_mismatches: [] },
        unlisted_body_keys: Object.keys(body),
        limitations: [...IPS_LIMITATIONS, `Only metadata is projected for bug_type ${bugType}; crash-body fields are not established.`],
      },
    };
  }

  const exceptionObj = asRecord(body['exception']);
  const exception = exceptionObj
    ? {
        type: stringOrNull(exceptionObj['type']),
        signal: stringOrNull(exceptionObj['signal']),
        subtype: stringOrNull(exceptionObj['subtype']),
        codes: stringOrNull(exceptionObj['codes']),
        message: stringOrNull(exceptionObj['message']),
        unlisted_keys: Object.keys(exceptionObj).filter((key) => !['type', 'signal', 'subtype', 'codes', 'message'].includes(key)),
      }
    : null;

  const terminationObj = asRecord(body['termination']);
  const termination = terminationObj
    ? {
        namespace: stringOrNull(terminationObj['namespace']),
        code: intField(terminationObj['code']),
        indicator: stringOrNull(terminationObj['indicator']),
        flags: intField(terminationObj['flags']),
        by_pid: intField(terminationObj['byPid']),
        by_proc: stringOrNull(terminationObj['byProc']),
        reasons: Array.isArray(terminationObj['reasons']) ? terminationObj['reasons'].filter((entry): entry is string => typeof entry === 'string') : null,
        unlisted_keys: Object.keys(terminationObj).filter((key) => !['namespace', 'code', 'indicator', 'flags', 'byPid', 'byProc', 'reasons'].includes(key)),
      }
    : null;

  const threadsRaw = Array.isArray(body['threads']) ? body['threads'] : [];
  if (threadsRaw.length > maxThreads) throw inputError(path, 'invalid_value', `the report declares ${threadsRaw.length} threads, more than max_threads=${maxThreads}`);
  const imagesRaw = Array.isArray(body['usedImages']) ? body['usedImages'] : [];
  if (imagesRaw.length > maxImages) throw inputError(path, 'invalid_value', `the report declares ${imagesRaw.length} images, more than max_images=${maxImages}`);

  const images: IpsImage[] = imagesRaw.map((imageValue, index) => {
    const image = asRecord(imageValue) ?? {};
    const uuid = stringOrNull(image['uuid']);
    const source = stringOrNull(image['source']);
    return {
      index,
      source,
      source_meaning: source === null ? null : (SOURCE_MEANING[source] ?? null),
      arch: stringOrNull(image['arch']),
      base: intField(image['base']),
      size: intField(image['size']),
      uuid,
      uuid_unknown: uuid === null,
      name: stringOrNull(image['name']),
      path: stringOrNull(image['path']),
    };
  });

  let frameCount = 0;
  let registerCount = 0;
  const threads: IpsThread[] = [];
  for (let index = 0; index < threadsRaw.length; index += 1) {
    const thread = asRecord(threadsRaw[index]) ?? {};
    const framesRaw = Array.isArray(thread['frames']) ? thread['frames'] : [];
    frameCount += framesRaw.length;
    if (frameCount > maxFrames) throw inputError(path, 'invalid_value', `the report exceeds max_frames=${maxFrames}`);
    const frames: IpsFrame[] = framesRaw.map((frameValue, frameIndex) => {
      const frame = asRecord(frameValue) ?? {};
      const imageIndex = typeof frame['imageIndex'] === 'number' ? frame['imageIndex'] : null;
      const imageOffset = intField(frame['imageOffset']);
      const explicit = intField(frame['runtimeAddress'] ?? frame['address']);
      let runtimeAddress = explicit;
      if (runtimeAddress === null && imageIndex !== null && imageOffset !== null) {
        const image = images[imageIndex];
        if (image?.base !== null && image?.base !== undefined) {
          const sum = BigInt(image.base.decimal) + BigInt(imageOffset.decimal);
          runtimeAddress = { decimal: String(sum), hex: `0x${sum.toString(16)}` };
        }
      }
      return {
        thread_index: index,
        frame_index: frameIndex,
        image_index: imageIndex,
        image_offset: imageOffset,
        runtime_address: runtimeAddress,
        role: frameIndex === 0 ? 'faulting_instruction' : 'return_address',
        inline: typeof frame['inline'] === 'boolean' ? frame['inline'] : null,
        recorded_symbol: stringOrNull(frame['symbol']),
        symbol_location: intField(frame['symbolLocation']),
      };
    });
    const registersObj = asRecord(thread['threadState']) ?? {};
    const registers = Object.entries(registersObj)
      .map(([name, value]) => {
        const parsed = intField(asRecord(value)?.['value'] ?? value);
        return parsed === null ? null : { name, value: parsed };
      })
      .filter((entry): entry is { name: string; value: { decimal: string; hex: string | null } } => entry !== null);
    registerCount += registers.length;
    if (registerCount > maxRegisters) throw inputError(path, 'invalid_value', `the report exceeds max_registers=${maxRegisters}`);
    threads.push({
      index,
      id: intField(thread['id']),
      triggered: typeof thread['triggered'] === 'boolean' ? thread['triggered'] : null,
      name: stringOrNull(thread['name']),
      queue: stringOrNull(thread['queue']),
      frames,
      state_flavor: stringOrNull(thread['flavor']),
      registers,
    });
  }

  const osVersionRaw = body['osVersion'];
  let osVersion: AppleIpsInspection['process']['os_version'] = null;
  if (typeof osVersionRaw === 'string') osVersion = { form: 'text', text: osVersionRaw };
  else {
    const osObj = asRecord(osVersionRaw);
    if (osObj !== null) {
      osVersion = {
        form: 'structured',
        train: stringOrNull(osObj['train']),
        build: stringOrNull(osObj['build']),
        release_type: stringOrNull(osObj['releaseType']),
        is_embedded: typeof osObj['isEmbedded'] === 'boolean' ? osObj['isEmbedded'] : null,
        unlisted_keys: Object.keys(osObj).filter((key) => !['train', 'build', 'releaseType', 'isEmbedded'].includes(key)),
      };
    }
  }

  return {
    path,
    resolvedPath,
    record: {
      artifact: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
      metadata,
      process: {
        name: stringOrNull(body['procName']),
        path: stringOrNull(body['procPath']),
        pid: intField(body['pid']),
        parent: stringOrNull(body['parentProc']),
        parent_pid: intField(body['parentPid']),
        cpu_type: stringOrNull(body['cpuType']),
        translated: typeof body['translated'] === 'boolean' ? body['translated'] : null,
        os_version: osVersion,
      },
      exception,
      termination,
      faulting_thread: typeof body['faultingThread'] === 'number' ? body['faultingThread'] : null,
      threads,
      images,
      classification: classify(body, exception, termination),
      coverage: {
        status: 'complete',
        reason: null,
        threads: threads.length,
        frames: frameCount,
        images: images.length,
        registers: registerCount,
        type_mismatches: [],
      },
      unlisted_body_keys: Object.keys(body).filter((key) => !KNOWN_BODY.has(key)),
      limitations: [...IPS_LIMITATIONS],
    },
  };
};
