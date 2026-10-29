import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

import { invalidRequest } from '../contract/errors.ts';

const execFileAsync = promisify(execFile);

export const OBJDUMP_LIMITATIONS = [
  'The executable version and supported formats are reported as unknown because no reliable version probe was performed.',
  'A non-zero process exit is preserved as an observed command result.',
  'When both are available, pre-run and post-run digests detect artifact changes across the provider call but cannot prove the exact bytes consumed during the call.',
] as const;

const OPERATION_FLAGS: Record<string, readonly string[]> = {
  file_headers: ['-f'],
  headers: ['-h'],
  private_headers: ['-p'],
  section_contents: ['-s'],
  disassemble: ['-d'],
};

export interface ObjdumpInspection {
  readonly subject: {
    readonly name: string;
    readonly digest: { readonly sha256: string };
    readonly local_path: string;
    readonly format: 'unknown';
    readonly architecture: null;
  };
  readonly parameters: {
    readonly path: string;
    readonly operation: string;
    readonly follow_debug_links: boolean;
    readonly provider_executable: string;
    readonly command_arguments: readonly string[];
  };
  readonly command: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exit_code: number;
    readonly signal: string | null;
    readonly output_truncated: boolean;
    readonly completion_status: 'complete';
    readonly artifact_sha256_after: string;
    readonly artifact_changed: boolean;
  };
  readonly limitations: readonly string[];
}

export const inspectWithObjdumpFromPath = async (
  path: string,
  options: {
    readonly cwd?: string;
    readonly operation?: string;
    readonly follow_debug_links?: boolean;
    readonly provider_executable?: string;
  } = {},
): Promise<{ readonly record: ObjdumpInspection; readonly path: string; readonly resolvedPath: string }> => {
  if (typeof path !== 'string' || path.length === 0) {
    throw invalidRequest('inspect_with_objdump requires path.', { operation: 'inspect_with_objdump', parameter: 'path' });
  }
  const operation = options.operation ?? 'file_headers';
  const flags = OPERATION_FLAGS[operation];
  if (flags === undefined) {
    throw invalidRequest(`inspect_with_objdump operation ${JSON.stringify(operation)} is not supported.`, {
      operation: 'inspect_with_objdump',
      parameter: 'operation',
    });
  }
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  const before = await readFile(resolvedPath);
  const shaBefore = createHash('sha256').update(before).digest('hex');
  const executable = options.provider_executable ?? 'objdump';
  const follow = options.follow_debug_links === true ? ['--dwarf=follow-links'] : [];
  const command_arguments = [...flags, ...follow, resolvedPath];
  let stdout = '';
  let stderr = '';
  let exit_code = 0;
  let signal: string | null = null;
  try {
    const result = await execFileAsync(executable, command_arguments, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      status?: number | null;
      signal?: NodeJS.Signals | null;
      code?: string | number | null;
    };
    stdout = typeof failure.stdout === 'string' ? failure.stdout : '';
    stderr = typeof failure.stderr === 'string' ? failure.stderr : '';
    exit_code = typeof failure.status === 'number' ? failure.status : typeof failure.code === 'number' ? failure.code : 1;
    signal = typeof failure.signal === 'string' ? failure.signal : null;
    if (failure.code === 'ENOENT') {
      throw invalidRequest(`Selected objdump executable could not be found: ${executable}`, {
        operation: 'inspect_with_objdump',
        parameter: 'provider_executable',
      });
    }
  }
  const after = await readFile(resolvedPath);
  const shaAfter = createHash('sha256').update(after).digest('hex');
  return {
    path,
    resolvedPath,
    record: {
      subject: {
        name: resolvedPath.split('/').pop() ?? resolvedPath,
        digest: { sha256: shaBefore },
        local_path: resolvedPath,
        format: 'unknown',
        architecture: null,
      },
      parameters: {
        path: resolvedPath,
        operation,
        follow_debug_links: options.follow_debug_links === true,
        provider_executable: executable,
        command_arguments,
      },
      command: {
        stdout,
        stderr,
        exit_code,
        signal,
        output_truncated: false,
        completion_status: 'complete',
        artifact_sha256_after: shaAfter,
        artifact_changed: shaBefore !== shaAfter,
      },
      limitations: [...OBJDUMP_LIMITATIONS],
    },
  };
};
