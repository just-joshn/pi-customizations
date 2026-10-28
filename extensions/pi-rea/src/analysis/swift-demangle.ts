
import { createHash } from 'node:crypto';
import { access, constants, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { capabilityUnavailable, executionFailure, invalidRequest, targetUnavailable } from '../contract/errors.ts';

export type DemangleStatus = 'demangled' | 'unchanged' | 'invalid';

export interface DemangledSymbol {
  readonly input: string;
  readonly output: string;
  readonly status: DemangleStatus;
}

export interface DemangleProvenance {
  readonly tool: 'swift-demangle';
  readonly command: readonly string[];
  readonly tool_version: null;
  readonly version_reason: string;
  readonly executable_sha256: string;
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  readonly stdout_bytes: number;
  readonly stderr_bytes: number;
}

export interface SwiftDemangleInspection {
  readonly symbols: readonly DemangledSymbol[];
  readonly provenance: readonly DemangleProvenance[];
  readonly limitations: readonly string[];
}

const VERSION_REASON =
  'Tool exposes no uniform stable version flag; executable SHA-256 is a prelaunch file sample and does not prove atomic OS image binding.';

const CANDIDATES = [
  '/Library/Developer/CommandLineTools/usr/bin/swift-demangle',
  '/usr/bin/swift-demangle',
] as const;

const resolveExecutable = async (): Promise<string> => {
  for (const candidate of CANDIDATES) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  try {
    const located = await runCapture('/usr/bin/xcrun', ['--find', 'swift-demangle'], 10_000);
    const path = located.stdout.trim();
    if (path.length > 0) {
      await access(path, constants.X_OK);
      return path;
    }
  } catch {}
  throw capabilityUnavailable(
    'swift-demangle is not available on this host. Install Xcode Command Line Tools or ensure xcrun can locate swift-demangle.',
    { operation: 'demangle_swift', reason: 'swift-demangle_missing' },
  );
};

const runCapture = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number | null; readonly signal: string | null }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(executionFailure(`swift-demangle exceeded native_command_timeout_ms=${timeoutMs}.`, { operation: 'demangle_swift' }));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal });
    });
  });

const assertSymbols = (symbols: unknown): string[] => {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw invalidRequest('demangle_swift requires a non-empty symbols array of non-empty strings.', {
      operation: 'demangle_swift',
      parameter: 'symbols',
    });
  }
  const out: string[] = [];
  for (const [index, entry] of symbols.entries()) {
    if (typeof entry !== 'string' || entry.length < 1) {
      throw invalidRequest(`symbols.${index}: Too small: expected string to have >=1 characters`, {
        operation: 'demangle_swift',
        issues: [{ path: ['symbols', index], reason: 'invalid_value', message: `symbols.${index}: Too small: expected string to have >=1 characters` }],
      });
    }
    out.push(entry);
  }
  return out;
};

export const mapDemangleOutputs = (symbols: readonly string[], stdout: string): DemangledSymbol[] => {
  const lines = stdout.length === 0 ? [] : stdout.replace(/\n$/, '').split('\n');
  let cursor = 0;
  return symbols.map((input) => {
    if (input === '_') {
      return { input, output: '', status: 'invalid' as const };
    }
    const output = lines[cursor];
    cursor += 1;
    if (output === undefined) {
      return { input, output: '', status: 'invalid' as const };
    }
    if (output === input) {
      return { input, output, status: 'unchanged' as const };
    }
    return { input, output, status: 'demangled' as const };
  });
};

export const demangleSwiftSymbols = async (
  symbolsInput: unknown,
  options: { readonly timeoutMs?: number; readonly requireOpenTarget?: boolean; readonly hasOpenTarget?: boolean } = {},
): Promise<SwiftDemangleInspection> => {
  if (options.requireOpenTarget !== false && options.hasOpenTarget !== true) {
    throw targetUnavailable('No app is open. Ask the user which app to investigate, then call open_binary with its local path.');
  }
  const symbols = assertSymbols(symbolsInput);
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw invalidRequest('native_command_timeout_ms must be an integer from 1 to 2147483647.', {
      operation: 'demangle_swift',
      parameter: 'native_command_timeout_ms',
    });
  }
  const executable = await resolveExecutable();
  const executableBytes = await readFile(executable);
  const executableSha256 = createHash('sha256').update(executableBytes).digest('hex');
  const command = [executable, '--compact', '--', ...symbols];
  const result = await runCapture(executable, ['--compact', '--', ...symbols], timeoutMs);
  if (result.code !== 0 && result.code !== null) {
    throw executionFailure(`swift-demangle exited with code ${result.code}.`, {
      operation: 'demangle_swift',
      exit_code: result.code,
      stderr_excerpt: result.stderr.slice(0, 512),
    });
  }
  return {
    symbols: mapDemangleOutputs(symbols, result.stdout),
    provenance: [
      {
        tool: 'swift-demangle',
        command,
        tool_version: null,
        version_reason: VERSION_REASON,
        executable_sha256: executableSha256,
        exit: { code: result.code, signal: result.signal },
        stdout_bytes: Buffer.byteLength(result.stdout, 'utf8'),
        stderr_bytes: Buffer.byteLength(result.stderr, 'utf8'),
      },
    ],
    limitations: [],
  };
};
