import { spawn } from 'node:child_process';

import type { ExecOutcome, ExecRequest } from './host.ts';

/** Runs a command with an explicit environment. Secrets stay out of argv. */
export async function isolatedExec(request: ExecRequest, environment: Readonly<Record<string, string | undefined>>): Promise<ExecOutcome> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined) env[name] = value;
  }
  return new Promise((resolve) => {
    const proc = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const killProcess = () => {
      if (killed) return;
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5000);
    };
    if (request.signal) {
      if (request.signal.aborted) killProcess();
      else request.signal.addEventListener('abort', killProcess, { once: true });
    }
    if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
      timeoutId = setTimeout(killProcess, request.timeoutMs);
    }
    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    const finish = (code: number | null) => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      request.signal?.removeEventListener('abort', killProcess);
      resolve({ stdout, stderr, code: code ?? 0, killed });
    };
    proc.on('error', () => finish(1));
    proc.on('close', (code) => finish(code));
  });
}
